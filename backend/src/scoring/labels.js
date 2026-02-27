export function scoreToLabel(score) {
  if (score >= 95) return "Bullseye";
  if (score >= 87) return "Very strong";
  if (score >= 79) return "Good shot";
  if (score >= 70) return "Modest odds";
  if (score >= 65) return "Long-shot";
  return "Probably no";
}
