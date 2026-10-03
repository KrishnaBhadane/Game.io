import { getSupabase } from '../lib/supabase.js'

const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function generateGameCode(length = 6) {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length))
  }
  return code
}

export async function createGame({
  hostId,
  name,
  startingBalance,
  allowedMultipliers,
  questionTimer,
}) {
  const maxRetries = 5

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const gameCode = generateGameCode(6)

    const { data, error } = await getSupabase()
      .from('games')
      .insert({
        host_id: hostId,
        name: name.trim(),
        game_code: gameCode,
        starting_balance: Number(startingBalance),
        allowed_multipliers: allowedMultipliers,
        question_timer: questionTimer ? parseInt(questionTimer, 10) : null,
        status: 'waiting',
      })
      .select()
      .single()

    if (!error) return data

    // Retry on unique constraint collision on game_code (PostgreSQL 23505)
    if (error.code === '23505' && attempt < maxRetries - 1) {
      continue
    }

    throw error
  }
}

export async function getGamesByHost(hostId) {
  const { data, error } = await getSupabase()
    .from('games')
    .select(
      'id, host_id, name, game_code, starting_balance, allowed_multipliers, question_timer, status, created_at',
    )
    .eq('host_id', hostId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function getGameByCode(gameCode) {
  const { data, error } = await getSupabase()
    .from('games')
    .select('*')
    .eq('game_code', gameCode.trim().toUpperCase())
    .maybeSingle()

  if (error) throw error
  return data
}

export async function ensurePlayerAuth() {
  const supabase = getSupabase()
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) throw sessionError

  if (session?.user) {
    return session.user
  }

  const { data: anonData, error: anonError } =
    await supabase.auth.signInAnonymously()
  if (anonError) throw anonError
  return anonData.user
}

export async function getGameForJoin(gameCode) {
  const supabase = getSupabase()
  const normalizedCode = gameCode.trim().toUpperCase()

  const { data, error } = await supabase.rpc('get_game_for_join', {
    p_game_code: normalizedCode,
  })

  if (error) throw error
  if (!data || data.length === 0) return null
  return data[0]
}

export async function joinGame({ gameCode, nickname, avatar }) {
  const supabase = getSupabase()
  const normalizedCode = gameCode.trim().toUpperCase()
  const trimmedNickname = nickname.trim()

  if (!normalizedCode) {
    throw new Error('Please enter a game code.')
  }

  if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
    throw new Error('Nickname must be between 2 and 20 characters.')
  }

  if (!avatar) {
    throw new Error('Please select an avatar.')
  }

  // 1. Ensure user has a session (anonymous or existing authenticated account)
  const user = await ensurePlayerAuth()

  // 2. Fetch game info using secure RPC
  const game = await getGameForJoin(normalizedCode)
  if (!game) {
    throw new Error('Game not found. Please check the code.')
  }

  // 3. Check if user has already joined this game (rejoin / refresh)
  const { data: existingPlayer, error: checkError } = await supabase
    .from('game_players')
    .select('*')
    .eq('game_id', game.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (checkError) throw checkError

  if (existingPlayer) {
    return { game, player: existingPlayer, isRejoin: true }
  }

  // 4. Verify game is waiting to accept new players
  if (game.status !== 'waiting') {
    throw new Error('This game has already started or ended.')
  }

  // 5. The server sets the game, user, balance, and score.
  const { data, error } = await supabase.rpc('join_game_player', {
    p_game_code: normalizedCode,
    p_nickname: trimmedNickname,
    p_avatar: avatar,
  })

  if (error) throw error

  const joined = Array.isArray(data) ? data[0] : data
  if (!joined) throw new Error('Unable to join game.')

  return {
    game: { ...game, id: joined.game_id, status: joined.status },
    player: {
      id: joined.player_id,
      game_id: joined.game_id,
      nickname: joined.nickname,
      avatar: joined.avatar,
      balance: joined.balance,
      score: joined.score,
    },
    isRejoin: false,
  }
}

export async function getPlayers(gameId) {
  const { data, error } = await getSupabase()
    .from('game_players')
    .select('id, nickname, avatar, balance, joined_at')
    .eq('game_id', gameId)
    .order('joined_at')

  if (error) throw error
  return data || []
}

export async function startGame(gameId) {
  const { data, error } = await getSupabase().rpc('start_game', {
    p_game_id: gameId,
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

export async function endGame(gameId) {
  const { error } = await getSupabase().rpc('end_game', { p_game_id: gameId })
  if (error) throw error
}

export async function deleteGame(gameId) {
  const { error } = await getSupabase().rpc('delete_game', {
    p_game_id: gameId,
  })
  if (error) throw error
}

export async function getPlayerForGame(gameCode) {
  const supabase = getSupabase()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.user) return { game: null, player: null }

  const game = await getGameForJoin(gameCode)
  if (!game) return { game: null, player: null }

  const { data: player, error } = await supabase
    .from('game_players')
    .select('*')
    .eq('game_id', game.id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (error) throw error
  // The public join lookup intentionally omits live state and game settings.
  return { game: player ? await getGameByCode(gameCode) : game, player }
}
