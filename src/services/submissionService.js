import { getSupabase } from '../lib/supabase.js'

// Risk label → multiplier value (matches DB)
export const RISK_MULTIPLIERS = {
  'No Risk': 1,
  '2x': 2,
  '3x': 3,
  '5x': 5,
}

// Submit answer via secure server-side RPC. Returns result object.
export async function submitAnswer({ questionId, selectedOption, riskLabel, wager = 10 }) {
  const { data, error } = await getSupabase().rpc('submit_answer', {
    p_question_id: questionId,
    p_selected_option: selectedOption,
    p_risk_label: riskLabel,
    p_wager: Number(wager),
  })
  if (error) throw error
  return data // { is_correct, correct_option, selected_option, risk_label, wager, balance_change, new_balance }
}

// Fetch a player's existing submission for a question (refresh-safe).
export async function getMySubmission(questionId) {
  const { data, error } = await getSupabase().rpc('get_my_submission', {
    p_question_id: questionId,
  })
  if (error) throw error
  return data // null if not submitted
}

// Fetch leaderboard for a game. Returns [{ nickname, avatar, balance, score, rank }].
export async function getLeaderboard(gameId) {
  const { data, error } = await getSupabase().rpc('get_leaderboard', {
    p_game_id: gameId,
  })
  if (error) throw error

  // Sort: 1. Balance desc, 2. Score desc
  const sorted = [...(data || [])].sort((a, b) => {
    if (Number(b.balance) !== Number(a.balance)) {
      return Number(b.balance) - Number(a.balance)
    }
    return (b.score || 0) - (a.score || 0)
  })

  // Assign standard competition ranking (1224) preserving shared ranks for ties
  let currentRank = 1
  return sorted.map((row, idx) => {
    if (idx > 0) {
      const prev = sorted[idx - 1]
      if (
        Number(row.balance) !== Number(prev.balance) ||
        (row.score || 0) !== (prev.score || 0)
      ) {
        currentRank = idx + 1
      }
    }
    return {
      name: row.nickname,
      nickname: row.nickname,
      avatar: row.avatar || 'straw-hat',
      balance: Number(row.balance),
      score: row.score ?? 0,
      rank: currentRank,
    }
  })
}

