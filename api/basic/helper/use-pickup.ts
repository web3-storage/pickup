export default function usePickup (rate: number): boolean {
  if (rate === 0) {
    return false
  }
  if (rate === 100) {
    return true
  }
  return Math.round(Math.random() * 100) < rate
}
