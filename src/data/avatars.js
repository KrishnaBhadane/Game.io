export const AVATARS = [
  { id: 'straw-hat', name: 'Straw Hat', emoji: '👒' },
  { id: 'swordsman', name: 'Swordsman', emoji: '⚔️' },
  { id: 'navigator', name: 'Navigator', emoji: '🧭' },
  { id: 'cook', name: 'Cook', emoji: '🍖' },
  { id: 'doctor', name: 'Doctor', emoji: '💊' },
  { id: 'captain', name: 'Captain', emoji: '👑' },
  { id: 'pirate-flag', name: 'Pirate Flag', emoji: '🏴‍☠️' },
  { id: 'sniper', name: 'Sniper', emoji: '🎯' },
  { id: 'shipwright', name: 'Shipwright', emoji: '🔨' },
  { id: 'musician', name: 'Musician', emoji: '🎻' },
]

export function getAvatarEmoji(avatarId) {
  const found = AVATARS.find((a) => a.id === avatarId)
  return found ? found.emoji : '👒'
}
