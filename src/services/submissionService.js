import { getSupabase } from '../lib/supabase.js'

// Risk label → multiplier value (matches DB)
export const RISK_MULTIPLIERS = {
  'No Risk': 1,
  '2x': 2,
  '3x': 3,
  '5x': 5,
}

// Submit returns a pending receipt, never correctness or payout information.
export async function submitAnswer({ questionId, selectedOption, riskLabel, wager = 10 }) {
  const { data, error } = await getSupabase().rpc('submit_answer', {
    p_question_id: questionId,
    p_selected_option: selectedOption,
    p_risk_label: riskLabel,
    p_wager: Number(wager),
  })
  if (error) throw error
  return data
}

// Restores pending submission or the result after the server deadline.
export async function getMySubmission(questionId) {
  const { data, error } = await getSupabase().rpc('get_my_submission', {
    p_question_id: questionId,
  })
  if (error) throw error
  return data // null if not submitted
}

// Fetch leaderboard for a game. DB RPC already orders by rank,joined_at with shared ranks.
export async function getLeaderboard(gameId) {
  const { data, error } = await getSupabase().rpc('get_leaderboard', {
    p_game_id: gameId,
  })
  if (error) throw error

  return (data || []).map((row) => ({
    nickname: row.nickname,
    isMe: row.is_me === true,
    avatar: row.avatar || 'straw-hat',
    balance: Number(row.balance),
    score: row.score ?? 0,
    rank: Number(row.rank),
  }))
}

export async function getMyGameSummary(gameId) {
  const { data, error } = await getSupabase().rpc('get_my_game_summary', {
    p_game_id: gameId,
  })
  if (error) throw error
  return data || []
}
