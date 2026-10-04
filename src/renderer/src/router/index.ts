import { createRouter, createWebHashHistory } from 'vue-router'
import Achievements from '@renderer/views/Achievements.vue'
import Dashboard from '@renderer/views/Dashboard.vue'
import FontManager from '@renderer/views/FontManager.vue'
import Import from '@renderer/views/Import.vue'
import Project from '@renderer/views/Project.vue'
import ProjectIndex from '@renderer/views/ProjectIndex.vue'
import Progress from '@renderer/views/Progress.vue'
import Settings from '@renderer/views/Settings.vue'
import LabelPlusPreview from '@renderer/views/LabelPlusPreview.vue'

// Use createWebHashHistory for Electron file:// protocol — hash routing avoids
// server-side route resolution which doesn't exist under file:// loads.
// Keep route pages in the main renderer bundle. This desktop app is small enough
// that the reliability benefit outweighs lazy-loading separate page chunks,
// especially when running from app.asar on older or restricted Windows systems.
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    {
      path: '/project',
      name: 'projectIndex',
      component: ProjectIndex
    },
    {
      path: '/project/:parentTitle/:childId',
      name: 'project',
      component: Project
    },
    {
      path: '/progress',
      name: 'progress',
      component: Progress
    },
    {
      path: '/achievements',
      name: 'achievements',
      component: Achievements
    },
    { path: '/fonts', name: 'fonts', component: FontManager },
    { path: '/import', name: 'import', component: Import },
    {
      path: '/labelplus-preview/:sessionId',
      name: 'labelplusPreview',
      component: LabelPlusPreview,
      meta: { standalone: true }
    },
    { path: '/settings', name: 'settings', component: Settings }
  ]
})

export default router
