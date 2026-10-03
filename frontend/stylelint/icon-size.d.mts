// Types of icon-size.mjs for its test: the plugin is plain JS, which Stylelint loads as is.
import type { Plugin } from 'stylelint'

export interface IconTag {
  classes: string[]
  line: number
  sizeAttribute?: string
  styleSize: boolean
}
export declare function iconTags(sfc: string): IconTag[]
declare const plugin: Plugin
export default plugin
