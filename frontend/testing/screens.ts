/**
 * Every screen of the app, imported as a test file loads (MOL-337). The app's routes load a screen when it is
 * first opened; a component test that moves to another screen through `routes` and reads where it landed after
 * `flushPromises` would wait on that screen's first transform instead. Imported here, the route's `import()`
 * finds the module already there and settles within the flush. Imported by such a file for its effect alone.
 */
import.meta.glob('/src/views/*View.vue', { eager: true })
