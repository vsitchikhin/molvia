// Types of display-type.mjs for its test: the plugin is plain JS, which Stylelint loads as is.
import type { Plugin } from 'stylelint'

export declare function roleMixins(code: string, known?: Set<string>): Set<string>
declare const plugin: Plugin
export default plugin
