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
    .select('id, host_id, name, game_code, starting_balance, allowed_multipliers, question_timer, status, created_at')
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

  // 5. Insert new player row
  const { data: newPlayer, error: insertError } = await supabase
    .from('game_players')
    .insert({
      game_id: game.id,
      user_id: user.id,
      nickname: trimmedNickname,
      avatar: avatar || 'straw-hat',
      balance: Number(game.starting_balance),
      score: 0,
    })
    .select()
    .single()

  if (insertError) {
    // Unique constraint collision on (game_id, user_id)
    if (insertError.code === '23505') {
      const { data: recheckPlayer } = await supabase
        .from('game_players')
        .select('*')
        .eq('game_id', game.id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (recheckPlayer) {
        return { game, player: recheckPlayer, isRejoin: true }
      }
    }
    throw insertError
  }

  return { game, player: newPlayer, isRejoin: false }
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
  const { error } = await getSupabase()
    .from('games')
    .update({ status: 'active' })
    .eq('id', gameId)

  if (error) throw error
}

export async function endGame(gameId) {
  const { error } = await getSupabase().rpc('end_game', { p_game_id: gameId })
  if (error) {
    if (error.code === 'PGRST202' || error.message?.includes('Could not find the function')) {
      const { error: updateError } = await getSupabase()
        .from('games')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', gameId)
      if (updateError) throw updateError
      return
    }
    throw error
  }
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
  return { game, player }
}

