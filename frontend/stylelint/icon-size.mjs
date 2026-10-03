// An icon's size is a step of --icon-* (Ф-9, MOL-173). The row chevron stood in five sizes, 18 to 26,
// and 24 had come in through `--space-6` in 23 places: width and height pass every other rule, so a
// size typed there was checked by nothing. An icon is `@include icon` — 1em both ways — with its step
// written beside it as `font-size`.
//
// What the rule holds:
//   - every icon of the template is sized: a rule that reaches it has `@include icon`, and its
//     font-size is a step — the font-size the last rule of the file that reaches it sets, or, if none
//     does, the one of its nearest ancestor that a rule sets (adversarial А1: a step alone draws the
//     1.2em unplugin-icons writes, 24 for a chevron of 20; the mixin alone draws the text around it).
//     A rule reaches an element when its selector matches the template — tags, static classes and
//     ids, the descendant and the child combinator, `:is()`/`:where()` as alternatives, `:not()` of
//     classes as their absence (В3, review 17) — and counts only without a condition: not under an
//     at-rule, with no pseudo-class (inside `:is()` too), attribute or sibling, and with no class the
//     element wears only by `:class` (Б2, В3, Г3: at rest the pair is not there). Every font-size of
//     the element the step is taken from, under a condition too, is a step (Г4);
//   - a rule on `svg` has both lines or neither; with the mixin, the nearest font-size around it is a
//     step — the last rule of the file for the same element (Б2, В5);
//   - on a rule that styles an icon — one whose last compound is `svg`, an icon's class, or that
//     reaches an icon by any other means (`.row > *`, Г2), and one on a part of it (`path`) —
//     `font-size` only `var(--icon*)` or `var(--state-glyph)`; width,
//     height, their logical and min-/max- forms only 1em; no padding or border width (the old pencil
//     was a box of 32 with a glyph of 16, А4, Б4), no scale, zoom, translate in depth, or transform but
//     a turn or a shift; no `@include` but `icon` and `wider-than-phone`, whose body is read like the
//     rule's (А6) — down a nested `@media` too (А2);
//   - in the template: an icon's class is its own, worn by nothing else (В2); no `style` with a size,
//     no `:style` or `v-bind="…"`, no `width=` or `height=` (А5, Б3);
//   - the steps themselves are declared in `_tokens.scss` alone: `--icon: 2rem` in a component would
//     make every line above right and the icon 32 (В1) — nor set by a `:style` of any tag, nor under
//     a name Sass interpolates (Г1).
//
// An icon is a tag imported from `~icons/` under any name or registered under another in
// `components` (Б5), a tag written `Icon…`/`icon-…`, or a `<component :is>` of an `icon` or a `glyph`
// that holds nothing — the name of its expression is how it is told from a card's `<component :is>`.
// A rule styles one when, its nesting resolved (`&`, `&-suffix`), the last compound of a selector is
// the tag `svg` (`:deep(svg)` opened, `:is()`/`:where()` read inside, `:not()` left out) or holds an
// icon's class.
// Out of its sight, by design: a class bound by `:class` — a rule needs it for a condition, never for
// a size; an icon styled from another file or put into the slot of a component that sizes its slot
// itself — `AppButton`, the one in `SIZED_SLOTS`; a step inherited through a component, which may set
// a font-size of its own; specificity, which the order of the file stands in for; a `<component :is>`
// named neither icon nor glyph; an SFC with no `<style>` block, which gives the rule no root.

import stylelint from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

const ruleName = 'molvia/icon-size'

// The components that size an icon put into their slot, with `:deep(svg)` of their own (В4).
const SIZED_SLOTS = new Set(['AppButton', 'app-button'])
// What renders no element of its own: an icon in it stands in its parent.
const TRANSPARENT = new Set([
  'template',
  'slot',
  'Transition',
  'TransitionGroup',
  'KeepAlive',
  'Suspense',
])
  .add('transition')
  .add('transition-group')
  .add('keep-alive')

const SIZE = /^(min-|max-)?(width|height|inline-size|block-size)$/
const PADDING = /^padding(-|$)/
const BORDER = /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width)?$/
const STEP = /^var\(--(icon(-[a-z0-9]+)*|state-glyph)\)$/
const STEP_NAME = /^--(icon(-[a-z0-9]+)*|state-glyph)$/
const TURN = new Set(['rotate', 'rotatez', 'translate', 'translatex', 'translatey'])
// `appear` moves and fades what comes in, and sizes nothing (review 20).
const ALLOWED_INCLUDES = new Set(['icon', 'wider-than-phone', 'appear'])
// The parts of an icon's svg: a rule on one is a rule on the icon's glyph (Г2).
const SVG_PARTS = new Set([
  'path',
  'g',
  'use',
  'circle',
  'rect',
  'polygon',
  'polyline',
  'line',
  'ellipse',
])
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

const messages = ruleMessages(ruleName, {
  size: (prop, value) =>
    `${prop}: ${value} on an icon. An icon is @include icon (1em) with its step as font-size: ` +
    `var(--icon-*) (DESIGN.md, MOL-173).`,
  step: (value) =>
    `font-size: ${value} on an icon. Its size is a step of the icon scale: var(--icon-*) or ` +
    `var(--state-glyph) (MOL-173).`,
  include: (name) =>
    `@include ${name} on an icon. An icon takes @include icon alone; a size brought by another mixin ` +
    `passes no check (MOL-173).`,
  missing: (what, where) =>
    `${where} has no ${what}. An icon is @include icon with its step as font-size: var(--icon-*) ` +
    `(MOL-173).`,
  unsized: (where) =>
    `${where} is sized by no rule: none that reaches it, without a condition, has @include icon with ` +
    `a step as its font-size (MOL-173).`,
  template: (what, line) =>
    `${what} on an icon in the template (line ${line}). Its size is the font-size of its class, a ` +
    `step of --icon-* (MOL-173).`,
  shared: (name, other, line) =>
    `.${name} is worn by an icon and by <${other}> (line ${line}). An icon's class is its own: a size ` +
    `in a rule of a shared class reaches the icon unchecked (MOL-173).`,
  role: (size, role, where) =>
    `${where} is drawn at ${size}; its role takes ${role} — the row's chevron is 20 everywhere (Ф-9).`,
  token: (prop) =>
    `${prop} is declared outside _tokens.scss. A step of the icon scale is the scale's, never set ` +
    `again in a component (MOL-173).`,
})

// --- the template -------------------------------------------------------------------------------

// A tag, opening or closing, the attributes' quotes kept: a `>` inside them ends no tag (А3).
const TAG = /<(\/?)([A-Za-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
const CLASS = /(?:^|\s)class=(?:"([^"]*)"|'([^']*)')/
const BOUND_CLASS = /(?:^|\s)(?::|v-bind:)class=(?:"([^"]*)"|'([^']*)')/
const ID = /(?:^|\s)id=(?:"([^"]*)"|'([^']*)')/
const BOUND_STEP =
  /(?:^|\s)(?::style|v-bind:style|v-bind)=(?:"[^"]*--(?:icon|state-glyph)|'[^']*--(?:icon|state-glyph))/
const SIZE_ATTRIBUTE = /(?:^|\s)(?::|v-bind:)?(width|height)=/
const BOUND_STYLE = /(?:^|\s)(?::style|v-bind:style|v-bind)=/
const IMPORT = /import\s+(\w+)\s+from\s+['"]~icons\/([^'"]+)['"]/g
// A role the import names: the row's chevron is 20 wherever it stands (Ф-9, Д3).
const ROLE_STEP = { 'mdi/chevron-right': 'var(--icon)' }
const COMPONENTS = /components\s*[:=]\s*\{([^}]*)\}/g

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const blank = (text) => text.replace(/[^\n]/g, ' ')

// The icons an SFC imports, by every name the template may use, each with the icon it is.
function iconNames(sfc) {
  const names = new Map()
  for (const [, name, icon] of sfc.matchAll(IMPORT)) names.set(name, icon)
  for (const [, body] of sfc.matchAll(COMPONENTS)) {
    for (const [, key, value] of body.matchAll(/(\w+)\s*:\s*(\w+)/g))
      if (names.has(value)) names.set(key, names.get(value))
  }
  for (const [name, icon] of [...names]) names.set(kebab(name), icon)
  return names
}

// The classes a `:class` names: the keys of an object, shorthand ones too, and the strings in quotes. A class built from a
// variable or a template string is named nowhere, and no rule reaches it.
function boundClasses(match) {
  const expression = match?.[1] ?? match?.[2] ?? ''
  const names = new Set()
  for (const [, quoted, key] of expression.matchAll(/'([\w-]+)'|([A-Za-z_][\w-]*)\s*:/g))
    names.add(quoted ?? key)
  // `{ accent }` — the shorthand the project writes (review 19).
  for (const [, short] of expression.matchAll(/[{,]\s*([A-Za-z_][\w-]*)\s*(?=[,}])/g))
    names.add(short)
  return names
}

// Every tag of an SFC's template: its name, where it stands, its static classes, its parent, whether
// it is an icon and what it says of a size in the template itself.
export function templateTags(sfc) {
  const open = sfc.search(/<template(\s[^>]*)?>/)
  const close = sfc.lastIndexOf('</template>')
  if (open < 0 || close < open) return []
  const icons = iconNames(sfc)
  const template = sfc.slice(0, close).replace(/<!--[\s\S]*?-->/g, blank)
  const tags = []
  const stack = []
  TAG.lastIndex = template.indexOf('>', open) + 1
  for (let m = TAG.exec(template); m; m = TAG.exec(template)) {
    const [whole, closing, name, attributes, selfClosing] = m
    if (closing) {
      const at = stack.findLastIndex((tag) => tag.name === name)
      if (at >= 0) stack.length = at
      continue
    }
    const empty =
      selfClosing !== '' ||
      new RegExp(`^\\s*</${name}>`).test(template.slice(m.index + whole.length))
    const icon =
      icons.has(name) ||
      /^Icon[A-Z]/.test(name) ||
      /^icon-/.test(name) ||
      (name === 'component' && empty && /\s(?::|v-bind:)is="[^"]*(icon|glyph)/i.test(attributes))
    const quoted = attributes.match(CLASS)
    const id = attributes.match(ID)
    const tag = {
      name,
      start: m.index,
      end: m.index + whole.length,
      line: sfc.slice(0, m.index).split('\n').length,
      classes: (quoted?.[1] ?? quoted?.[2] ?? '').split(/\s+/).filter(Boolean),
      boundClasses: boundClasses(attributes.match(BOUND_CLASS)),
      id: id?.[1] ?? id?.[2],
      boundStep: BOUND_STEP.test(attributes),
      parent: stack[stack.length - 1],
      icon,
      // Imported, the icon it is; else read off the house name, `IconChevronRight` → `mdi/chevron-right`.
      iconId:
        icons.get(name) ??
        (/^Icon[A-Z]/.test(name) ? `mdi/${kebab(name.slice(4))}` : undefined) ??
        (/^icon-/.test(name) ? `mdi/${name.slice(5)}` : undefined),
      sizeAttribute: icon ? attributes.match(SIZE_ATTRIBUTE)?.[1] : undefined,
      boundStyle: icon && BOUND_STYLE.test(attributes),
    }
    tags.push(tag)
    if (!selfClosing && !VOID.has(name.toLowerCase())) stack.push(tag)
  }
  return tags
}

// A tag of the template that is no HTML element: a component, or the `<component>` placeholder.
const isComponent = (tag) =>
  /[A-Z]/.test(tag.name) || tag.name.includes('-') || tag.name === 'component'

// The element around a tag in the page: the parent, past what renders nothing of its own. A
// `<Teleport>` carries what it holds out of the page around it: nothing above it is an ancestor (Д2).
function up(tag) {
  let parent = tag.parent
  while (parent && TRANSPARENT.has(parent.name)) parent = parent.parent
  return parent && /^teleport$/i.test(parent.name) ? undefined : parent
}

// --- selectors ----------------------------------------------------------------------------------

// The parts of a selector between the characters `at` matches, outside parentheses.
function split(selector, at) {
  const parts = []
  let depth = 0
  let part = ''
  for (const char of selector) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth === 0 && at.test(char)) {
      if (part.trim()) parts.push(part.trim())
      part = ''
      continue
    }
    part += char
  }
  if (part.trim()) parts.push(part.trim())
  return parts
}

const ruleAround = (node) => {
  let parent = node.parent
  while (parent && parent.type !== 'rule') parent = parent.parent
  return parent
}

// A rule's selectors with its nesting resolved: `&` replaced by the selector around it — so `&-chevron`
// is glued to it (А7) — and a selector with no `&` put under it.
function resolved(rule) {
  const own = split(rule.selector, /,/)
  const parent = ruleAround(rule)
  if (!parent) return own
  return resolved(parent).flatMap((outer) =>
    own.map((inner) => (inner.includes('&') ? inner.replaceAll('&', outer) : `${outer} ${inner}`)),
  )
}

const classesOf = (compound) =>
  [...compound.replace(/:not\([^()]*\)/g, '').matchAll(/\.([\w-]+)/g)].map((m) => m[1])

// A selector read for matching: its compounds, the combinators between them, and whether it is a
// condition — a pseudo-class, an attribute or a sibling anywhere in it.
function parse(selector) {
  const opened = selector.replace(/:(deep|global|slotted)\(([^()]*)\)/g, ' $2').trim()
  const compounds = []
  const combinators = []
  let depth = 0
  let part = ''
  let pending = ''
  const push = () => {
    if (!part.trim()) return
    if (compounds.length) combinators.push(pending || ' ')
    compounds.push(part.trim())
    part = ''
    pending = ''
  }
  for (const char of opened) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth === 0 && /[\s>+~]/.test(char)) {
      push()
      if (char !== ' ' && char !== '\n' && char !== '\t') pending = char
      continue
    }
    part += char
  }
  push()
  // `:root` is the page itself: an ancestor of everything, no condition.
  while (compounds.length > 1 && compounds[0] === ':root') {
    compounds.shift()
    combinators.shift()
  }
  const last = compounds[compounds.length - 1] ?? ''
  return {
    text: compounds
      .map((c, i) =>
        i ? `${combinators[i - 1] === ' ' ? ' ' : ` ${combinators[i - 1]} `}${c}` : c,
      )
      .join(''),
    compounds,
    combinators,
    svg: /(^|[(,]\s*)svg(?![\w-])/.test(last.replace(/:not\([^()]*\)/g, '')),
    classes: classesOf(last),
    condition: compounds.some(conditionIn) || combinators.some((c) => c === '+' || c === '~'),
  }
}

// A condition in a compound: a pseudo-class or an attribute — inside `:is()`/`:where()` too (Г3). A
// `:not()` of classes, tags and ids and `:root` are none: the template answers them (review 17).
function conditionIn(compound) {
  const plain = /^[\w.#*-]*$/
  const rest = compound
    .replace(/:not\(([^()]*)\)/g, (all, inner) =>
      split(inner, /,/).every((one) => plain.test(one)) ? '' : all,
    )
    .replace(/:(is|where)\(([^()]*)\)/g, (all, kind, inner) => (/[[:]/.test(inner) ? all : ''))
    .replace(/^:root$/, '')
  return /[[:]/.test(rest)
}

// Whether a compound matches an element of the template. A class the element wears only by `:class`
// counts when `bound` allows it — to know which rules style an icon, never for its size (Г3).
function compoundMatches(compound, tag, bound) {
  const alternatives = compound.match(/:(is|where)\(([^()]*)\)/)
  if (alternatives) {
    const rest = compound.replace(alternatives[0], '')
    return split(alternatives[2], /,/).some((one) => compoundMatches(`${rest}${one}`, tag, bound))
  }
  const negated = compound.match(/:not\(([^()]*)\)/)
  if (negated) {
    const rest = compound.replace(negated[0], '')
    const absent = split(negated[1], /,/).every(
      (one) =>
        !compoundMatches(one, tag, false) &&
        (bound || !classesOf(one).some((name) => tag.boundClasses.has(name))),
    )
    return absent && compoundMatches(rest, tag, bound)
  }
  const structure = compound.replace(/:[\w-]+(\([^()]*\))?/g, '').replace(/\[[^\]]*\]/g, '')
  const type = structure.match(/^[a-zA-Z][\w-]*|^\*/)?.[0]
  if (type && type !== '*') {
    if (tag.icon) {
      if (type !== 'svg') return false
    } else if (isComponent(tag) || tag.name.toLowerCase() !== type.toLowerCase()) return false
  }
  const ids = [...structure.matchAll(/#([\w-]+)/g)].map((m) => m[1])
  if (ids.some((id) => id !== tag.id)) return false
  return classesOf(structure).every(
    (name) => tag.classes.includes(name) || (bound && tag.boundClasses.has(name)),
  )
}

// Whether a selector reaches an element of the template: by its structure, a class from `:class`
// counted only when `bound` allows it.
function reaches(selector, tag, bound = false) {
  const { compounds, combinators } = selector
  const at = (i, element) => {
    if (!compoundMatches(compounds[i], element, bound)) return false
    if (i === 0) return true
    if (combinators[i - 1] === '>') {
      const parent = up(element)
      return parent ? at(i - 1, parent) : false
    }
    for (let parent = up(element); parent; parent = up(parent)) if (at(i - 1, parent)) return true
    return false
  }
  return compounds.length > 0 && at(compounds.length - 1, tag)
}

// --- the rule -----------------------------------------------------------------------------------

// A rule's declarations and includes, down its at-rules but not into a nested rule, which is checked
// as a rule of its own (А2).
function ownNodes(rule) {
  const nodes = []
  const walk = (node) => {
    for (const child of node.nodes ?? []) {
      if (child.type === 'rule') continue
      nodes.push(child)
      if (child.type === 'atrule') walk(child)
    }
  }
  walk(rule)
  return nodes
}

// What a rule says without a condition: its own children, none under an at-rule (Б2).
const direct = (rule) => (rule.nodes ?? []).filter((node) => node.type !== 'rule')
const inAtRule = (rule) => {
  for (let node = rule.parent; node && node.type !== 'root'; node = node.parent) {
    if (node.type === 'atrule') return true
  }
  return false
}

const mixinOf = (node) => node.params.split(/[\s(]/)[0]
const isMixin = (node) =>
  node.type === 'atrule' && node.name === 'include' && mixinOf(node) === 'icon'
const fontSize = (node) => node.type === 'decl' && node.prop === 'font-size'
const isStep = (value) => STEP.test(value.trim())

function resizes(prop, value) {
  // A minimum of nothing and a maximum of all leave a 1em icon as it is (review 20).
  if (/^min-/.test(prop) && /^(0|auto)$/.test(value)) return false
  if (/^max-/.test(prop) && /^(none|100%)$/.test(value)) return false
  if (SIZE.test(prop)) return value !== '1em'
  if (PADDING.test(prop)) return !/^0(\s+0)*$/.test(value)
  if (BORDER.test(prop)) return !/^(0|none|hidden)(\s|$)/.test(value)
  if (prop === 'scale') return !/^(none|1)$/.test(value)
  if (prop === 'zoom') return !/^(1|normal|reset)$/.test(value)
  if (prop === 'translate') return !/^(none|\S+(\s+\S+)?(\s+0)?)$/.test(value)
  if (prop === 'transform') {
    if (value === 'none') return false
    return [...value.matchAll(/([\w-]+)\(/g)].some(([, name]) => !TURN.has(name.toLowerCase()))
  }
  return false
}

function rule(primary) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: primary })) return

    const flag = (node, message) => report({ ruleName, result, node, message })

    // The steps are the scale's: declared in _tokens.scss alone (В1).
    if (!root.source?.input.file?.endsWith('/styles/_tokens.scss')) {
      root.walkDecls((decl) => {
        // A custom property whose name Sass builds may be any step (Д1): none is needed here.
        if (STEP_NAME.test(decl.prop) || (decl.prop.includes('#{') && /^(--|#\{)/.test(decl.prop)))
          flag(decl, messages.token(decl.prop))
      })
    }

    const sfc = (root.document ?? root).source?.input.css ?? ''
    const tags = templateTags(sfc)
    const icons = tags.filter((tag) => tag.icon)
    const iconClasses = new Set(icons.flatMap((tag) => tag.classes))

    // A `style="…"` of the template is a root of its own: on an icon it holds no size (А5, Б3).
    if (root.source?.inline) {
      const at = root.source.start?.offset ?? 0
      const tag = tags.find((t) => t.start <= at && at < t.end)
      if (!tag?.icon) return
      root.walkDecls((decl) => {
        const value = decl.value.trim()
        if (resizes(decl.prop, value)) flag(decl, messages.size(decl.prop, value))
        if (fontSize(decl) && !isStep(value)) flag(decl, messages.step(value))
      })
      return
    }

    // A rule on a part of an svg (`path`) is an icon's when the selector before it reaches an icon of
    // the template — a chart's own `<svg><rect>` is none (review 21).
    const partOfIcon = (selector) => {
      const last = selector.compounds[selector.compounds.length - 1] ?? ''
      if (!SVG_PARTS.has(last.match(/^[a-z]+/)?.[0] ?? '') || selector.compounds.length < 2)
        return false
      const before = parse(selector.compounds.slice(0, -1).join(' '))
      return icons.some((tag) => reaches(before, tag, true))
    }

    const blocks = root.document
      ? root.document.nodes.filter((node) => node.type === 'root' && !node.source?.inline)
      : [root]
    const all = blocks.flatMap((block) => {
      const rules = []
      block.walkRules((node) => {
        const selectors = resolved(node).map(parse)
        rules.push({
          node,
          selectors,
          icon: selectors.some(
            (s) =>
              s.svg ||
              s.classes.some((name) => iconClasses.has(name)) ||
              partOfIcon(s) ||
              icons.some((tag) => reaches(s, tag, true)),
          ),
          svg: selectors.some((s) => s.svg),
          // Counted for a size only without a condition (Б2, В3).
          plain: !inAtRule(node),
        })
      })
      return rules
    })
    all.forEach((entry, order) => (entry.order = order))

    // The rules that reach an element, without a condition, in the order of the file.
    const reaching = (tag) =>
      all.filter(
        (entry) => entry.plain && entry.selectors.some((s) => !s.condition && reaches(s, tag)),
      )

    // The font-size an element ends with: the last rule of the file that reaches it and sets one —
    // and, if any rule under a condition gives it another, one that is no step (Г4).
    const ownSize = (tag) => {
      const set = reaching(tag).flatMap((entry) => direct(entry.node).filter(fontSize))
      const last = set[set.length - 1]?.value
      if (last === undefined) return undefined
      const any = all
        .filter((entry) => entry.selectors.some((s) => reaches(s, tag, true)))
        .flatMap((entry) => ownNodes(entry.node).filter(fontSize))
      return any.find((decl) => !isStep(decl.value))?.value ?? last
    }

    // The step around a rule on svg no element of the template stands for (a slot's icon): the last
    // font-size of the file for the nearest element its selector names (Б2, В5).
    function stepAround(entry) {
      if (direct(entry.node).some((n) => fontSize(n) && isStep(n.value))) return true
      return entry.selectors.some((selector) => {
        for (let k = selector.compounds.length - 1; k > 0; k--) {
          const prefix = parse(selector.compounds.slice(0, k).join(' ')).text
          const same = all.filter((other) => other.selectors.some((s) => s.text === prefix))
          const set = same
            .filter((other) => other.plain)
            .flatMap((other) => direct(other.node).filter(fontSize))
          if (set.length)
            return same
              .flatMap((other) => ownNodes(other.node).filter(fontSize))
              .every((d) => isStep(d.value))
        }
        return false
      })
    }

    for (const entry of all.filter((e) => e.icon && e.node.root() === root)) {
      const { node } = entry
      for (const child of ownNodes(node)) {
        if (
          child.type === 'atrule' &&
          child.name === 'include' &&
          !ALLOWED_INCLUDES.has(mixinOf(child))
        )
          flag(child, messages.include(mixinOf(child)))
        if (child.type !== 'decl') continue
        const value = child.value.trim()
        if (resizes(child.prop, value)) flag(child, messages.size(child.prop, value))
        if (fontSize(child) && !isStep(value)) flag(child, messages.step(value))
      }

      // A rule on svg comes with the pair, or with neither — then it only colours.
      if (!entry.svg) continue
      const where = `«${node.selector}»`
      const mixed = direct(node).some(isMixin)
      const stepped = direct(node).some((n) => fontSize(n) && isStep(n.value))
      if (stepped && !mixed) flag(node, messages.missing('@include icon', where))
      if (mixed && !stepAround(entry)) flag(node, messages.missing('step as font-size', where))
    }

    // The template is the document's: read once, with its first style block.
    if (blocks[0] !== root) return

    for (const tag of tags.filter((t) => t.boundStep)) {
      flag(root, messages.token(`--icon in a bound style (line ${tag.line})`))
    }

    for (const tag of tags.filter((t) => !t.icon)) {
      for (const name of tag.classes) {
        if (iconClasses.has(name)) flag(root, messages.shared(name, tag.name, tag.line))
      }
    }

    for (const tag of icons) {
      if (tag.sizeAttribute) flag(root, messages.template(`${tag.sizeAttribute}=`, tag.line))
      if (tag.boundStyle) flag(root, messages.template('A bound style', tag.line))

      // An icon put straight into the slot of a component that sizes it is the component's; a step
      // of its own there needs no mixin, the component gives it (Д4).
      const parent = up(tag)
      const rules = reaching(tag)
      const slotted = Boolean(parent && SIZED_SLOTS.has(parent.name))
      if (
        slotted &&
        !rules.some((entry) => direct(entry.node).some((n) => isMixin(n) || fontSize(n)))
      )
        continue

      const where = tag.classes.length
        ? `The icon «.${tag.classes.join('.')}» (line ${tag.line})`
        : `<${tag.name}> (line ${tag.line})`
      const anchor =
        all.find((entry) =>
          entry.selectors.some((s) => s.classes.some((c) => tag.classes.includes(c))),
        )?.node ?? root
      const mixed = slotted || rules.some((entry) => direct(entry.node).some(isMixin))
      let size = ownSize(tag)
      for (
        let above = up(tag);
        size === undefined && above && !isComponent(above);
        above = up(above)
      ) {
        size = ownSize(above)
      }
      const stepped = size !== undefined && isStep(size)
      const role = ROLE_STEP[tag.iconId]
      if (stepped && role && size.trim() !== role)
        flag(anchor, messages.role(size.trim(), role, where))
      if (mixed && stepped) continue
      if (!mixed && !stepped && !rules.some((entry) => direct(entry.node).some(fontSize))) {
        flag(anchor, messages.unsized(where))
      } else {
        if (!mixed) flag(anchor, messages.missing('@include icon', where))
        if (!stepped) flag(anchor, messages.missing('step as font-size', where))
      }
    }
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
