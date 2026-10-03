// An icon's size is a step of --icon-* (Ф-9, MOL-173). The row chevron stood in five sizes, 18 to 26,
// and 24 had come in through `--space-6` in 23 places: width and height pass every other rule, so a
// size typed there was checked by nothing. An icon is `@include icon` — 1em both ways — with its step
// written beside it as `font-size`.
//
// What the rule holds, on an icon:
//   - it is sized: by the rules of its class — `@include icon` and a step, both, written without a
//     condition (adversarial А1: a step alone draws the 1.2em unplugin-icons sets, 24 for a chevron of
//     20; the mixin alone draws the text around it; Б2: a pair under `@media` or `:hover` is no pair
//     on a phone at rest) — or, with no class or a class that only colours it, by a rule on `svg`
//     under an element of the template it stands in (Б1, Б6);
//   - a rule on `svg` has both lines or neither, and then only colours; its step is in itself, or the
//     nearest `font-size` around it — up the nesting, or a rule of the same selector written flat —
//     is a step (Б2: a step of text between wins);
//   - `font-size` only `var(--icon*)` or `var(--state-glyph)`;
//   - width, height, their logical and min-/max- forms only 1em; no padding or border width (the old
//     pencil was a box of 32 with a glyph of 16, А4, Б4), no scale, zoom or transform but a turn or a
//     shift; no `@include` but `icon` and `wider-than-phone`, whose body is read like the rule's (a
//     mixin of its own carried a width past the rule, А6) — down a nested `@media` too (А2);
//   - in the template: no `style` with a size, no `:style` or `v-bind="…"` at all, no `width=` or
//     `height=` (А5, Б3).
//
// An icon is a tag imported from `~icons/` under any name or registered under another in
// `components` (Б5), a tag written `Icon…`/`icon-…`, or a `<component :is>` of an icon or a glyph
// that holds nothing. A rule styles one when, its nesting resolved (`&`, `&-suffix`), the last compound
// of a selector is the tag `svg` (`:deep(svg)` opened, `:is()`/`:where()` read inside, `:not()` left
// out) or holds a class that in the template stands on icons only (a class shared with text — `muted`
// — makes no rule an icon's).
// Out of its sight, by design: a class bound by `:class`; an icon styled from another file or put
// straight into a component's slot — `AppButton` sizes its own; an SFC with no `<style>` block, which
// gives the rule no root to run on.

import stylelint from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

const ruleName = 'molvia/icon-size'

const SIZE = /^(min-|max-)?(width|height|inline-size|block-size)$/
const PADDING = /^padding(-|$)/
const BORDER = /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width)?$/
const STEP = /^var\(--(icon(-[a-z0-9]+)*|state-glyph)\)$/
const TURN = new Set(['rotate', 'rotatez', 'translate', 'translatex', 'translatey'])
const ALLOWED_INCLUDES = new Set(['icon', 'wider-than-phone'])
// A state of the page, not a context: a rule under it is a condition, and its pair no pair.
const STATE =
  /:(hover|focus|focus-visible|focus-within|active|checked|disabled|enabled|visited|target|open|invalid|valid|placeholder-shown)(?![\w-])/
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
    `${where} is sized by no rule: neither its class nor a rule on svg under the element it stands in ` +
    `has @include icon with a step (MOL-173).`,
  template: (what, line) =>
    `${what} on an icon in the template (line ${line}). Its size is the font-size of its class, a ` +
    `step of --icon-* (MOL-173).`,
})

// --- the template -------------------------------------------------------------------------------

// A tag, opening or closing, the attributes' quotes kept: a `>` inside them ends no tag (А3).
const TAG = /<(\/?)([A-Za-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
const CLASS = /(?:^|\s)class=(?:"([^"]*)"|'([^']*)')/
const SIZE_ATTRIBUTE = /(?:^|\s)(?::|v-bind:)?(width|height)=/
const BOUND_STYLE = /(?:^|\s)(?::style|v-bind:style|v-bind)=/
const IMPORT = /import\s+(\w+)\s+from\s+['"]~icons\/[^'"]+['"]/g
const COMPONENTS = /components\s*[:=]\s*\{([^}]*)\}/g

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const blank = (text) => text.replace(/[^\n]/g, ' ')

function iconNames(sfc) {
  const names = new Set()
  for (const [, name] of sfc.matchAll(IMPORT)) names.add(name)
  for (const [, body] of sfc.matchAll(COMPONENTS)) {
    for (const [, key, value] of body.matchAll(/(\w+)\s*:\s*(\w+)/g))
      if (names.has(value)) names.add(key)
  }
  for (const name of [...names]) names.add(kebab(name))
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
    const tag = {
      name,
      start: m.index,
      end: m.index + whole.length,
      line: sfc.slice(0, m.index).split('\n').length,
      classes: (quoted?.[1] ?? quoted?.[2] ?? '').split(/\s+/).filter(Boolean),
      parent: stack[stack.length - 1],
      icon,
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

// What a selector styles: the tag svg in its last compound, the classes there, the classes of the
// compounds before it, the selector before the last compound, and whether it is a state of the page.
function target(selector) {
  const opened = selector.replace(/:(deep|global|slotted)\(([^()]*)\)/g, ' $2')
  const compounds = split(opened, /[\s>+~]/)
  const last = compounds[compounds.length - 1] ?? ''
  return {
    svg: /(^|[(,]\s*)svg(?![\w-])/.test(last.replace(/:not\([^()]*\)/g, '')),
    classes: classesOf(last),
    context: compounds.slice(0, -1).flatMap(classesOf),
    prefix: compounds.slice(0, -1).join(' '),
    state: STATE.test(selector),
  }
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
const isStep = (node) => fontSize(node) && STEP.test(node.value.trim())

function resizes(prop, value) {
  if (SIZE.test(prop)) return value !== '1em'
  if (PADDING.test(prop)) return !/^0(\s+0)*$/.test(value)
  if (BORDER.test(prop)) return !/^(0|none|hidden)(\s|$)/.test(value)
  if (prop === 'scale') return !/^(none|1)$/.test(value)
  if (prop === 'zoom') return !/^(1|normal|reset)$/.test(value)
  if (prop === 'transform') {
    if (value === 'none') return false
    return [...value.matchAll(/([\w-]+)\(/g)].some(([, name]) => !TURN.has(name.toLowerCase()))
  }
  return false
}

function rule(primary) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: primary })) return

    const sfc = (root.document ?? root).source?.input.css ?? ''
    const tags = templateTags(sfc)
    const icons = tags.filter((tag) => tag.icon)
    // A class an icon wears and nothing else does; a shared one names no icon (замечание 11).
    const others = new Set(tags.filter((tag) => !tag.icon).flatMap((tag) => tag.classes))
    const iconOnly = new Set(
      icons.flatMap((tag) => tag.classes).filter((name) => !others.has(name)),
    )
    const flag = (node, message) => report({ ruleName, result, node, message })

    // A `style="…"` of the template is a root of its own: on an icon it holds no size (А5, Б3).
    if (root.source?.inline) {
      const at = root.source.start?.offset ?? 0
      const tag = tags.find((t) => t.start <= at && at < t.end)
      if (!tag?.icon) return
      root.walkDecls((decl) => {
        const value = decl.value.trim()
        if (resizes(decl.prop, value)) flag(decl, messages.size(decl.prop, value))
        if (fontSize(decl) && !STEP.test(value)) flag(decl, messages.step(value))
      })
      return
    }

    const blocks = root.document
      ? root.document.nodes.filter((node) => node.type === 'root' && !node.source?.inline)
      : [root]
    const all = blocks.flatMap((block) => {
      const rules = []
      block.walkRules((node) => {
        const targets = resolved(node).map(target)
        rules.push({
          node,
          targets,
          icon: targets.some((t) => t.svg || t.classes.some((name) => iconOnly.has(name))),
          svg: targets.some((t) => t.svg),
          // A pair counts without a condition only: no state, no media around it (Б2).
          plain: !inAtRule(node) && !targets.some((t) => t.state),
        })
      })
      return rules
    })

    // The step of a rule on svg: in itself, or the nearest font-size around it — up the nesting, or a
    // rule of the same selector written flat — is a step (Б2, Б6).
    function stepped(entry) {
      if (direct(entry.node).some(isStep)) return true
      for (let around = ruleAround(entry.node); around; around = ruleAround(around)) {
        const size = direct(around).find(fontSize)
        if (size) return isStep(size)
      }
      const prefixes = new Set(entry.targets.map((t) => t.prefix).filter(Boolean))
      return all.some(
        (other) =>
          other.plain &&
          resolved(other.node).some((selector) => prefixes.has(selector)) &&
          direct(other.node).some(isStep),
      )
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
        if (fontSize(child) && !STEP.test(value)) flag(child, messages.step(value))
      }

      // A rule on svg comes with the pair, or with neither — then it only colours.
      if (!entry.svg) continue
      const where = `«${node.selector}»`
      const mixed = direct(node).some(isMixin)
      if (direct(node).some(isStep) && !mixed) flag(node, messages.missing('@include icon', where))
      if (mixed && !stepped(entry)) flag(node, messages.missing('step as font-size', where))
    }

    // The template is the document's: read once, with its first style block.
    if (blocks[0] !== root) return

    // A rule on svg under the element an icon stands in, that sizes it: the pair, no condition, and
    // the classes of its context worn by the icon's ancestors (Б1).
    const sizedFromAbove = (tag) => {
      const above = new Set()
      for (let parent = tag.parent; parent; parent = parent.parent)
        parent.classes.forEach((c) => above.add(c))
      return all.some(
        (entry) =>
          entry.svg &&
          entry.plain &&
          direct(entry.node).some(isMixin) &&
          stepped(entry) &&
          entry.targets.some((t) => t.svg && t.context.every((name) => above.has(name))),
      )
    }

    const seen = new Set()
    for (const tag of icons) {
      if (tag.sizeAttribute) flag(root, messages.template(`${tag.sizeAttribute}=`, tag.line))
      if (tag.boundStyle) flag(root, messages.template('A bound style', tag.line))

      const own = tag.classes.filter((name) => iconOnly.has(name))
      const where = own.length
        ? `The icon «.${own.join('.')}» (line ${tag.line})`
        : `<${tag.name}> (line ${tag.line})`
      const key = own.length ? own.sort().join(' ') : `line ${tag.line}`
      if (seen.has(key)) continue
      seen.add(key)

      const wearing = all.filter(
        (entry) =>
          entry.plain && entry.targets.some((t) => t.classes.some((name) => own.includes(name))),
      )
      const nodes = wearing.flatMap((entry) => direct(entry.node))
      const mixed = nodes.some(isMixin)
      const step = nodes.some(isStep)
      const anchor = wearing[0]?.node ?? root
      if (mixed && step) continue
      if (mixed !== step) {
        flag(anchor, messages.missing(mixed ? 'step as font-size' : '@include icon', where))
        continue
      }
      // Neither by its class: an icon put straight into a component's slot is the component's to size.
      let parent = tag.parent
      while (parent?.name === 'template') parent = parent.parent
      if (own.length === 0 && parent && isComponent(parent)) continue
      if (!sizedFromAbove(tag)) flag(anchor, messages.unsized(where))
    }
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
