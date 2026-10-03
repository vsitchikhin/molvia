// Types of icon-size.mjs for its test: the plugin is plain JS, which Stylelint loads as is.
import type { Plugin } from 'stylelint'

export interface TemplateTag {
  name: string
  start: number
  end: number
  line: number
  classes: string[]
  parent?: TemplateTag
  icon: boolean
  sizeAttribute?: string
  boundStyle: boolean
}
export declare function templateTags(sfc: string): TemplateTag[]
declare const plugin: Plugin
export default plugin
