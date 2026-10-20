// Keeps a picture's stable appearance tags from fighting the outfit the scene
// actually describes. A character's appearance block is reused for every shot,
// so an anchor that mentions garments ("ivory top", "scarlet skirt") wins over a
// nude scene's clothing tags: the sampler sees the garment words first. When the
// clothing tags state the body is bare, those garment phrases are dropped from
// the appearance text used for this picture only. The stored appearance block is
// never rewritten.
const NUDE = /\b(?:nude|naked|topless|undressed|fully undressed|completely nude|bare breasts|bare chest|bare skin|bare torso|no clothes|without clothes|stripped bare)\b/i
const GARMENT = /\b(?:top|tops|dress|gown|robe|skirt|skirts|shawl|sash|jacket|blouse|shirt|coat|kimono|hanfu|costume|clothing|clothes|garment|garments|collar|neckline|necklines|sleeve|sleeves|waistband|belt|corset|bra|brassiere|underwear|undergarment|garments|lingerie|chemise|stockings|socks|shoes|boots|trousers|pants|tunic|cloak|cape|veil|apron|embroidery|embroidered|pattern|patterns|botanical|ornament|ornaments|hem|hemline|cuff|cuffs|placket|satin|brocade)\b/i
// Poses and staging leak into a reused anchor made from a character sheet; they
// describe a different picture and fight the shot the planner chose.
const STAGING = /\b(?:leaning|standing|sitting|kneeling|posing|pose|hand at waist|window frame|lattice|screen|bokeh|backlight|rim light|glow|framing|vertical|depth of field|background)\b/i

export function statesBareClothing(tags) {
  return typeof tags === 'string' && NUDE.test(tags)
}

export function stripGarmentTags(tags) {
  if (typeof tags !== 'string') return tags
  return tags.split(',').map(part => part.trim()).filter(part => part && !GARMENT.test(part) && !STAGING.test(part)).join(', ')
}
