import { decodeFrame } from './decode'
import { serveFrames } from './serveFrames'

serveFrames(decodeFrame)
