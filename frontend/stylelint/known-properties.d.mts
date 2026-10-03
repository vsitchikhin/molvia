// Types of known-properties.mjs for its test: the plugin is plain JS, which Stylelint loads as is.
import type { Plugin } from 'stylelint'

export declare const SET_BY_SCRIPT: Record<string, string>
export declare function rootNames(code: string): string[]
export declare function withoutComments(source: string): string
declare const plugin: Plugin
export default plugin
