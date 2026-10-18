import test from 'node:test'
import assert from 'node:assert/strict'
import { updateSceneDraft, assembleSceneDraft } from '../tavern-plugin/lib/domain/scene-plan-draft.js'

test('repairing a field replaces its stale expression, including persisted drafts', () => {
  const draft = { characters: { p: { id: 'p', fields: {}, expressions: { clothing: '', appearance: 'black hair' } } },
    layout: { description: '', subjects: ['p'], continuity: 'continued', scene: { composition: { text: '半身', tags: 'upper body' } }, expressions: { composition: '', environment: 'garden' } } }
  const next = updateSceneDraft(draft, 'submit_scene_character', { id: 'p', fields: { clothing: { text: '蓝外套', tags: 'blue coat' } } })
  assert.deepEqual(next.characters.p.expressions, { appearance: 'black hair' })
  assert.equal(draft.characters.p.expressions.clothing, '')
  next.characters.p.expressions.clothing = ''
  assert.deepEqual(assembleSceneDraft(next).expressions, [{ owner: 'p', field: 'appearance', tags: 'black hair' }, { owner: 'scene', field: 'environment', tags: 'garden' }])
  assert.throws(() => updateSceneDraft(next, 'submit_scene_character', { id: 'p', fields: { clothing: { text: '蓝外套', tags: '' } } }), /同时/)
})
