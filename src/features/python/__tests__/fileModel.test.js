import { describe, it, expect } from 'vitest'
import {
  FILES_STORAGE_KEY,
  ENTRY_FILE,
  DEFAULT_MAIN,
  normalizeFilename,
  isValidFilename,
  moduleName,
  createDefaultProject,
  fileNames,
  serializeProject,
  deserializeProject,
  uniqueName,
  addFile,
  renameFile,
  deleteFile,
  setActive,
  setContent,
  activeContent,
} from '../fileModel'

describe('filename helpers', () => {
  it('normalizeFilename trims, strips paths, and forces a single .py extension', () => {
    expect(normalizeFilename(' utils ')).toBe('utils.py')
    expect(normalizeFilename('utils.py')).toBe('utils.py')
    expect(normalizeFilename('utils.PY')).toBe('utils.py')
    expect(normalizeFilename('a/b/c/mod.py')).toBe('mod.py')
    expect(normalizeFilename('..\\..\\evil.py')).toBe('evil.py')
    expect(normalizeFilename('')).toBe('')
    expect(normalizeFilename('   ')).toBe('')
  })

  it('isValidFilename accepts module-safe names only', () => {
    expect(isValidFilename('main.py')).toBe(true)
    expect(isValidFilename('_helpers.py')).toBe(true)
    expect(isValidFilename('mod2.py')).toBe(true)
    expect(isValidFilename('2bad.py')).toBe(false)
    expect(isValidFilename('has space.py')).toBe(false)
    expect(isValidFilename('no-ext')).toBe(false)
    expect(isValidFilename('dir/x.py')).toBe(false)
    expect(isValidFilename('dotted.name.py')).toBe(false)
  })

  it('moduleName drops the .py extension', () => {
    expect(moduleName('utils.py')).toBe('utils')
    expect(moduleName('main.py')).toBe('main')
  })
})

describe('createDefaultProject', () => {
  it('starts with a single active main.py containing the default source', () => {
    const p = createDefaultProject()
    expect(fileNames(p)).toEqual([ENTRY_FILE])
    expect(p.active).toBe(ENTRY_FILE)
    expect(p.files[ENTRY_FILE]).toBe(DEFAULT_MAIN)
  })
})

describe('serialize / deserialize round-trip', () => {
  it('serializes to JSON and parses back identically', () => {
    const p = { files: { 'main.py': 'print(1)', 'utils.py': 'x = 2' }, active: 'utils.py' }
    const json = serializeProject(p)
    expect(typeof json).toBe('string')
    const back = deserializeProject(json)
    expect(back.files).toEqual(p.files)
    expect(back.active).toBe('utils.py')
    // Insertion order preserved.
    expect(fileNames(back)).toEqual(['main.py', 'utils.py'])
  })

  it('uses the documented storage key', () => {
    expect(FILES_STORAGE_KEY).toBe('python-files')
  })

  it('falls back to a default project on malformed / empty input', () => {
    for (const bad of ['', 'not json', '{}', '{"files":null}', null, undefined, '{"files":{}}']) {
      const p = deserializeProject(bad)
      expect(fileNames(p)).toEqual([ENTRY_FILE])
      expect(p.files[ENTRY_FILE]).toBe(DEFAULT_MAIN)
      expect(p.active).toBe(ENTRY_FILE)
    }
  })

  it('migrates a legacy single-file draft into main.py when nothing is saved', () => {
    const legacy = 'print("old draft")'
    const p = deserializeProject(null, legacy)
    expect(fileNames(p)).toEqual([ENTRY_FILE])
    expect(p.files[ENTRY_FILE]).toBe(legacy)
  })

  it('does NOT use the legacy draft when a file-set already exists', () => {
    const json = serializeProject({ files: { 'main.py': 'a', 'b.py': 'bb' }, active: 'b.py' })
    const p = deserializeProject(json, 'IGNORED LEGACY')
    expect(p.files['main.py']).toBe('a')
    expect(p.files['b.py']).toBe('bb')
  })

  it('drops entries with invalid filenames and repairs a bad active pointer', () => {
    const p = deserializeProject(JSON.stringify({
      files: { 'main.py': 'a', 'bad name.py': 'b', 'ok.py': 'c' },
      active: 'bad name.py',
    }))
    expect(fileNames(p)).toEqual(['main.py', 'ok.py'])
    expect(p.active).toBe('main.py') // first valid file, since active was invalid
  })

  it('serialize repairs an out-of-range active pointer', () => {
    const json = serializeProject({ files: { 'main.py': 'a' }, active: 'gone.py' })
    expect(JSON.parse(json).active).toBe('main.py')
  })
})

describe('uniqueName', () => {
  it('returns untitled.py first, then numbered variants', () => {
    let p = createDefaultProject()
    expect(uniqueName(p)).toBe('untitled.py')
    p = { files: { 'main.py': '', 'untitled.py': '' }, active: 'main.py' }
    expect(uniqueName(p)).toBe('untitled1.py')
    p = { files: { 'untitled.py': '', 'untitled1.py': '' }, active: 'untitled.py' }
    expect(uniqueName(p)).toBe('untitled2.py')
  })
})

describe('addFile', () => {
  it('adds a named file and makes it active without mutating the input', () => {
    const p0 = createDefaultProject()
    const { project, name, error } = addFile(p0, 'utils', 'x = 1')
    expect(error).toBe(null)
    expect(name).toBe('utils.py')
    expect(project.active).toBe('utils.py')
    expect(project.files['utils.py']).toBe('x = 1')
    expect(fileNames(project)).toEqual(['main.py', 'utils.py'])
    // input untouched
    expect(fileNames(p0)).toEqual(['main.py'])
  })

  it('auto-names when no name is given', () => {
    const { project, name } = addFile(createDefaultProject(), null)
    expect(name).toBe('untitled.py')
    expect(project.active).toBe('untitled.py')
  })

  it('rejects duplicates and invalid names', () => {
    const p = createDefaultProject()
    expect(addFile(p, 'main').error).toBe('duplicate')
    expect(addFile(p, '2bad').error).toBe('invalid')
    expect(addFile(p, 'has space').error).toBe('invalid')
  })
})

describe('renameFile', () => {
  it('renames in place, preserving order, and follows the active pointer', () => {
    const p = { files: { 'a.py': '1', 'b.py': '2', 'c.py': '3' }, active: 'b.py' }
    const { project, name, error } = renameFile(p, 'b.py', 'renamed')
    expect(error).toBe(null)
    expect(name).toBe('renamed.py')
    expect(fileNames(project)).toEqual(['a.py', 'renamed.py', 'c.py'])
    expect(project.files['renamed.py']).toBe('2')
    expect(project.active).toBe('renamed.py')
  })

  it('does not move the active pointer when renaming an inactive file', () => {
    const p = { files: { 'a.py': '1', 'b.py': '2' }, active: 'a.py' }
    const { project } = renameFile(p, 'b.py', 'z')
    expect(project.active).toBe('a.py')
  })

  it('is a no-op when renaming to the same name', () => {
    const p = createDefaultProject()
    const { project, error } = renameFile(p, 'main.py', 'main.py')
    expect(error).toBe(null)
    expect(project).toBe(p) // unchanged reference
  })

  it('rejects duplicates, invalid names, and missing source', () => {
    const p = { files: { 'a.py': '1', 'b.py': '2' }, active: 'a.py' }
    expect(renameFile(p, 'a.py', 'b').error).toBe('duplicate')
    expect(renameFile(p, 'a.py', '2bad').error).toBe('invalid')
    expect(renameFile(p, 'nope.py', 'x').error).toBe('missing')
  })
})

describe('deleteFile', () => {
  it('removes a file and reactivates a neighbour when the active one goes', () => {
    const p = { files: { 'a.py': '1', 'b.py': '2', 'c.py': '3' }, active: 'b.py' }
    const { project, error } = deleteFile(p, 'b.py')
    expect(error).toBe(null)
    expect(fileNames(project)).toEqual(['a.py', 'c.py'])
    expect(project.active).toBe('a.py') // previous neighbour
  })

  it('reactivates the next file when deleting the first active file', () => {
    const p = { files: { 'a.py': '1', 'b.py': '2' }, active: 'a.py' }
    const { project } = deleteFile(p, 'a.py')
    expect(project.active).toBe('b.py')
  })

  it('keeps the active pointer when deleting a non-active file', () => {
    const p = { files: { 'a.py': '1', 'b.py': '2', 'c.py': '3' }, active: 'c.py' }
    const { project } = deleteFile(p, 'a.py')
    expect(project.active).toBe('c.py')
  })

  it('refuses to delete the last remaining file', () => {
    const p = createDefaultProject()
    const { project, error } = deleteFile(p, 'main.py')
    expect(error).toBe('last')
    expect(project).toBe(p)
  })

  it('reports missing files', () => {
    expect(deleteFile(createDefaultProject(), 'ghost.py').error).toBe('missing')
  })
})

describe('setActive / setContent / activeContent', () => {
  it('setActive switches only to known files', () => {
    const p = { files: { 'a.py': '1', 'b.py': '2' }, active: 'a.py' }
    expect(setActive(p, 'b.py').active).toBe('b.py')
    expect(setActive(p, 'ghost.py')).toBe(p) // unchanged
  })

  it('setContent updates a file immutably', () => {
    const p = { files: { 'a.py': '1' }, active: 'a.py' }
    const next = setContent(p, 'a.py', 'changed')
    expect(next.files['a.py']).toBe('changed')
    expect(p.files['a.py']).toBe('1') // input untouched
    expect(setContent(p, 'ghost.py', 'x')).toBe(p)
  })

  it('activeContent returns the active file source', () => {
    const p = { files: { 'a.py': 'AA', 'b.py': 'BB' }, active: 'b.py' }
    expect(activeContent(p)).toBe('BB')
    expect(activeContent({ files: {}, active: 'x' })).toBe('')
  })
})
