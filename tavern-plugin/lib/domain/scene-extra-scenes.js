// A second picture must not depend on the planner remembering an optional field.
// When a hand-started picture was planned with an empty additionalScenes, pick a
// sentence far from the main anchor as an extra shot. The sentence is copied
// verbatim so the anchor still lands in the story text; the planning Agent then
// chooses the actual framing for that moment.
export function fallbackExtraScenes(plan, targetText) {
  if (typeof targetText !== 'string' || !targetText.trim()) return []
  const main = typeof plan?.anchor === 'string' ? plan.anchor.trim() : ''
  const lines = targetText.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.includes('```') && !line.includes('<') && !/^nsfw$/i.test(line))
  const sentences = []
  for (const line of lines) {
    for (const part of line.split(/(?<=[。！？…])/)) {
      const text = part.trim()
      if (text.length >= 12 && text.length <= 120 && !text.includes('`')) sentences.push(text)
    }
  }
  if (!sentences.length) return []
  const mainIndex = main ? sentences.findIndex(item => item.includes(main) || main.includes(item)) : -1
  const candidates = sentences.filter(item => !main || !(item.includes(main) || main.includes(item)))
  if (!candidates.length) return []
  const distance = item => mainIndex < 0 ? 0 : Math.abs(sentences.indexOf(item) - mainIndex)
  const pick = [...candidates].sort((a, b) => distance(b) - distance(a))[0]
  if (targetText.indexOf(pick) < 0) return []
  return [{
    anchor: pick,
    description: '另一个可画瞬间：' + pick,
    viewpoint: plan?.viewpoint === 'omniscient' ? 'omniscient' : 'first-person'
  }]
}
