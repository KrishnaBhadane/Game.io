import { getSupabase } from '../lib/supabase'

const FIELDS =
  'id, game_id, question_text, option_a, option_b, option_c, option_d, correct_option, order_number, time_limit_seconds'

export async function getQuestions(gameId) {
  const { data, error } = await getSupabase()
    .from('questions')
    .select(FIELDS)
    .eq('game_id', gameId)
    .order('order_number')

  if (error) throw error
  return data || []
}

export async function saveQuestion(gameId, question) {
  const { id, ...values } = { ...question, game_id: gameId }
  const query = id
    ? getSupabase().from('questions').update(values).eq('id', id)
    : getSupabase().from('questions').insert(values)

  const { data, error } = await query.select(FIELDS).single()
  if (error) throw error
  return data
}

export async function deleteQuestion(id) {
  const { error } = await getSupabase().from('questions').delete().eq('id', id)
  if (error) throw error
}

// Sets the live question for a game via secure RPC (blocks publish on ended games).
export async function publishQuestion(gameId, questionId) {
  const { error } = await getSupabase().rpc('publish_question', {
    p_game_id: gameId,
    p_question_id: questionId,
  })
  if (error) {
    if (error.code === 'PGRST202' || error.message?.includes('Could not find the function')) {
      const { error: updateError } = await getSupabase()
        .from('games')
        .update({
          current_question_id: questionId,
          question_started_at: new Date().toISOString(),
        })
        .eq('id', gameId)
      if (updateError) throw updateError
      return
    }
    throw error
  }
}


// Fetches the current live question for a player — never returns correct_option.
export async function getLiveQuestion(gameCode) {
  const { data, error } = await getSupabase().rpc('get_live_question', {
    p_game_code: gameCode,
  })
  if (error) throw error
  if (!data || data.length === 0) return null
  return data[0]
}
