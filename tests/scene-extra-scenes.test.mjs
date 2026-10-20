import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fallbackExtraScenes } from '../tavern-plugin/lib/domain/scene-extra-scenes.js'

const story = [
  '里屋更暗。窗纸糊得厚，只透进一层灰黄。',
  '潘金莲走到床边，背对着你，两只手绕到颈后。',
  '浅葱色的短衫先松下来，从肩上滑脱，她随手搭在床沿。',
  '她站着，转过来。',
  '窗纸那层光从她侧面打过来。白，是那种少见日头的白；肩窄，两只胳膊垂着。'
].join('\n')

test('an empty plan still yields a second shot from the story text', () => {
  const plan = { anchor: '潘金莲走到床边，背对着你，两只手绕到颈后。', viewpoint: 'first-person' }
  const scenes = fallbackExtraScenes(plan, story)
  assert.equal(scenes.length, 1)
  assert.equal(scenes[0].viewpoint, 'first-person')
  assert.ok(story.includes(scenes[0].anchor), 'anchor must be copied verbatim')
  assert.notEqual(scenes[0].anchor, plan.anchor)
  assert.ok(scenes[0].description.includes(scenes[0].anchor))
})

test('the extra shot picks a far sentence, not the neighbouring one', () => {
  const plan = { anchor: '潘金莲走到床边，背对着你，两只手绕到颈后。', viewpoint: 'first-person' }
  const [scene] = fallbackExtraScenes(plan, story)
  assert.ok(!scene.anchor.includes('浅葱色的短衫'), scene.anchor)
  assert.ok(!scene.anchor.includes('她站着，转过来'), scene.anchor)
})

test('fenced blocks, markup and short lines never become anchors', () => {
  const text = 'nsfw\n\n```大焱朝·金县```\n短句。\n她把门帘放下，屋里只剩一层灰黄的光，谁也没有先开口。\n<content>\n*（他不动。）*'
  const [scene] = fallbackExtraScenes({ anchor: '', viewpoint: 'omniscient' }, text)
  assert.ok(scene)
  assert.ok(!scene.anchor.includes('```'))
  assert.ok(!scene.anchor.includes('<'))
  assert.equal(scene.viewpoint, 'omniscient')
})
