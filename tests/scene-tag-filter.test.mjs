import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statesBareClothing, stripGarmentTags } from '../tavern-plugin/lib/domain/scene-tag-filter.js'

test('a nude outfit statement drops reused garment phrases from the appearance anchor', () => {
  const appearance = '1girl, solo, adult woman, chinese fantasy costume, glossy black hair, ivory white wide-sleeved cross-collar top, deep peacock green shawl, high waisted vermilion silk satin skirt, gold botanical pattern, red huadian on forehead, small brown teardrop mole under right eye'
  const clothing = 'nude figure, only small cloth undergarment held in hand at hip, bare breasts, thin sweat sheen'
  assert.equal(statesBareClothing(clothing), true)
  const kept = stripGarmentTags(appearance)
  assert.match(kept, /glossy black hair/)
  assert.match(kept, /red huadian on forehead/)
  assert.doesNotMatch(kept, /top|costume|shawl|skirt|satin/)
  assert.match(stripGarmentTags(appearance), /^1girl, solo, adult woman/)
})

test('partial undress keeps the established outfit', () => {
  const clothing = 'pale leek-green cross-collar short jacket undone and slipping off both shoulders, cloth bunched at her elbows'
  assert.equal(statesBareClothing(clothing), false)
  assert.match(clothing, /jacket/)
})

test('non-garment descriptors survive untouched', () => {
  assert.equal(stripGarmentTags('tall figure, full bust, narrow waist, glossy black hair'), 'tall figure, full bust, narrow waist, glossy black hair')
})

import { currentAppearanceTags, assertSingleFootwearState } from '../tavern-plugin/lib/domain/scene-tag-filter.js'
test('当前换装与赤脚会清除参考锚点中的旧胸衣、丝袜和高跟，保留稳定外貌', () => {
 const anchor='adult woman, long black hair, black lace corset, sheer black stockings, deep burgundy high heels, blue eyes'
 const clothing='white shirt, thin cotton shorts, barefoot'
 assert.equal(currentAppearanceTags(anchor,clothing),'adult woman, long black hair, blue eyes')
 assert.equal(currentAppearanceTags(anchor,''),anchor)
 assert.equal(currentAppearanceTags('blue eyes, barefoot','wearing black boots'),'blue eyes')
 assert.doesNotThrow(()=>assertSingleFootwearState(clothing))
 assert.throws(()=>assertSingleFootwearState('white shirt, barefoot, burgundy high heels'),/赤脚与穿鞋/)
 assert.doesNotThrow(()=>assertSingleFootwearState('barefoot, high heels on the floor'))
 assert.doesNotThrow(()=>assertSingleFootwearState('barefoot, no shoes'))
 assert.doesNotThrow(()=>assertSingleFootwearState('not barefoot, wearing high heels'))
})
