<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { greetingForDate, greetingSalutation, millisecondsUntilNextGreetingSlot } from '@renderer/utils/dashboardGreeting'
const userIdDisplay = ref('朋友')
const currentClock = ref(new Date())
const animatedGreeting = ref('')
const greetingAnimationComplete = ref(false)
const plexusCanvas = ref<HTMLCanvasElement | null>(null)
const greetingTimers = new Set<number>()
let greetingAnimationToken = 0
let greetingMounted = false
let clockTimer: number | undefined
let plexusContext: CanvasRenderingContext2D | null = null
let plexusFrame: number | undefined
let plexusResizeObserver: ResizeObserver | undefined
let plexusThemeObserver: MutationObserver | undefined

interface PlexusParticle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

let plexusWidth = 0
let plexusHeight = 0
let plexusParticles: PlexusParticle[] = []
const plexusMouse = { x: -9_999, y: -9_999 }
const PLEXUS_LINK_DISTANCE = 118
const PLEXUS_MOUSE_RADIUS = 132
const PLEXUS_MOTION_SCALE = 1 / 3
const PLEXUS_MAX_SPEED = 1.25 * PLEXUS_MOTION_SCALE

const greetingText = computed(() => greetingForDate(currentClock.value))

function prefersReducedMotion(): boolean {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function spawnPlexusParticles(): void {
  const count = Math.round(Math.min(86, Math.max(36, (plexusWidth * plexusHeight) / 5_800)))
  plexusParticles = Array.from({ length: count }, () => ({
    x: Math.random() * plexusWidth,
    y: Math.random() * plexusHeight,
    vx: (Math.random() - 0.5) * 0.62 * PLEXUS_MOTION_SCALE,
    vy: (Math.random() - 0.5) * 0.62 * PLEXUS_MOTION_SCALE,
    radius: 1.15 + Math.random() * 1.25
  }))
}

function resizePlexus(): void {
  const canvas = plexusCanvas.value
  if (!canvas || !plexusContext) return
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width || canvas.clientWidth))
  const height = Math.max(1, Math.round(rect.height || canvas.clientHeight))
  if (width === plexusWidth && height === plexusHeight && canvas.width > 1) return
  plexusWidth = width
  plexusHeight = height
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  plexusContext.setTransform(dpr, 0, 0, dpr, 0, 0)
  spawnPlexusParticles()
  drawPlexusFrame(false)
}

function advancePlexusParticles(): void {
  for (const particle of plexusParticles) {
    const dx = particle.x - plexusMouse.x
    const dy = particle.y - plexusMouse.y
    const distance = Math.hypot(dx, dy)
    if (distance < PLEXUS_MOUSE_RADIUS && distance > 0) {
      const force = (1 - distance / PLEXUS_MOUSE_RADIUS) * 0.72 * PLEXUS_MOTION_SCALE
      particle.vx += (dx / distance) * force
      particle.vy += (dy / distance) * force
    }
    particle.x += particle.vx
    particle.y += particle.vy
    if (particle.x < 0 || particle.x > plexusWidth) particle.vx *= -1
    if (particle.y < 0 || particle.y > plexusHeight) particle.vy *= -1
    particle.x = Math.max(0, Math.min(plexusWidth, particle.x))
    particle.y = Math.max(0, Math.min(plexusHeight, particle.y))
    const speed = Math.hypot(particle.vx, particle.vy)
    if (speed > PLEXUS_MAX_SPEED) {
      particle.vx *= PLEXUS_MAX_SPEED / speed
      particle.vy *= PLEXUS_MAX_SPEED / speed
    }
  }

  for (let leftIndex = 0; leftIndex < plexusParticles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plexusParticles.length; rightIndex += 1) {
      const left = plexusParticles[leftIndex]
      const right = plexusParticles[rightIndex]
      const dx = right.x - left.x
      const dy = right.y - left.y
      const minimum = left.radius + right.radius
      const squaredDistance = dx * dx + dy * dy
      if (squaredDistance <= 0 || squaredDistance >= minimum * minimum) continue
      const distance = Math.sqrt(squaredDistance)
      const nx = dx / distance
      const ny = dy / distance
      const impulse = (left.vx - right.vx) * nx + (left.vy - right.vy) * ny
      if (impulse > 0) {
        left.vx -= impulse * nx
        left.vy -= impulse * ny
        right.vx += impulse * nx
        right.vy += impulse * ny
      }
      const overlap = (minimum - distance) / 2
      left.x -= nx * overlap
      left.y -= ny * overlap
      right.x += nx * overlap
      right.y += ny * overlap
    }
  }
}

function drawPlexusFrame(advance = true): void {
  const canvas = plexusCanvas.value
  const context = plexusContext
  if (!canvas || !context || plexusWidth <= 1 || plexusHeight <= 1) return
  if (advance) advancePlexusParticles()
  context.clearRect(0, 0, plexusWidth, plexusHeight)
  const styles = getComputedStyle(canvas)
  context.lineWidth = 0.8
  context.strokeStyle = styles.getPropertyValue('--text-secondary').trim() || '#808080'
  for (let leftIndex = 0; leftIndex < plexusParticles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plexusParticles.length; rightIndex += 1) {
      const left = plexusParticles[leftIndex]
      const right = plexusParticles[rightIndex]
      const distance = Math.hypot(left.x - right.x, left.y - right.y)
      if (distance >= PLEXUS_LINK_DISTANCE) continue
      context.globalAlpha = (1 - distance / PLEXUS_LINK_DISTANCE) * 0.18
      context.beginPath()
      context.moveTo(left.x, left.y)
      context.lineTo(right.x, right.y)
      context.stroke()
    }
  }
  context.globalAlpha = 0.23
  context.fillStyle = styles.getPropertyValue('--accent').trim() || '#4d8f6f'
  for (const particle of plexusParticles) {
    context.beginPath()
    context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
    context.fill()
  }
  context.globalAlpha = 1
}

function runPlexusFrame(): void {
  if (document.hidden) { plexusFrame = undefined; return }
  drawPlexusFrame(true)
  plexusFrame = window.requestAnimationFrame(runPlexusFrame)
}

function restartPlexus(): void {
  if (plexusFrame !== undefined) window.cancelAnimationFrame(plexusFrame)
  plexusFrame = undefined
  resizePlexus()
  if (prefersReducedMotion() || document.hidden) drawPlexusFrame(false)
  else plexusFrame = window.requestAnimationFrame(runPlexusFrame)
}

function initializePlexus(): void {
  const canvas = plexusCanvas.value
  if (!canvas) return
  try {
    plexusContext = canvas.getContext('2d')
  } catch {
    plexusContext = null
  }
  if (!plexusContext) return
  if (typeof ResizeObserver === 'function') {
    plexusResizeObserver = new ResizeObserver(() => resizePlexus())
    plexusResizeObserver.observe(canvas)
  }
  if (typeof MutationObserver === 'function') {
    plexusThemeObserver = new MutationObserver(() => drawPlexusFrame(false))
    plexusThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style']
    })
  }
  window.addEventListener('resize', resizePlexus)
  document.addEventListener('visibilitychange', restartPlexus)
  restartPlexus()
}

function destroyPlexus(): void {
  if (plexusFrame !== undefined) window.cancelAnimationFrame(plexusFrame)
  plexusFrame = undefined
  plexusResizeObserver?.disconnect()
  plexusResizeObserver = undefined
  plexusThemeObserver?.disconnect()
  plexusThemeObserver = undefined
  window.removeEventListener('resize', resizePlexus)
  document.removeEventListener('visibilitychange', restartPlexus)
  plexusContext = null
  plexusParticles = []
}

function onGreetingPointerMove(event: PointerEvent): void {
  const canvas = plexusCanvas.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  plexusMouse.x = event.clientX - rect.left
  plexusMouse.y = event.clientY - rect.top
}

function onGreetingPointerLeave(): void {
  plexusMouse.x = -9_999
  plexusMouse.y = -9_999
}

function clearGreetingTimers(): void {
  greetingAnimationToken += 1
  for (const timer of greetingTimers) window.clearTimeout(timer)
  greetingTimers.clear()
}

function scheduleGreetingRefresh(): void {
  if (clockTimer !== undefined) window.clearTimeout(clockTimer)
  const now = new Date()
  currentClock.value = now
  clockTimer = window.setTimeout(() => {
    scheduleGreetingRefresh()
  }, millisecondsUntilNextGreetingSlot(now))
}

function scheduleGreetingStep(callback: () => void, delayMs: number): void {
  const timer = window.setTimeout(() => {
    greetingTimers.delete(timer)
    callback()
  }, delayMs)
  greetingTimers.add(timer)
}

function runGreetingAnimation(): void {
  clearGreetingTimers()
  const token = greetingAnimationToken
  const greetingCharacters = Array.from(greetingText.value)
  animatedGreeting.value = ''
  greetingAnimationComplete.value = false

  if (prefersReducedMotion()) {
    animatedGreeting.value = greetingCharacters.join('')
    greetingAnimationComplete.value = true
    return
  }

  const typeGreeting = (index: number): void => {
    if (token !== greetingAnimationToken) return
    animatedGreeting.value = greetingCharacters.slice(0, index).join('')
    if (index < greetingCharacters.length) {
      const character = greetingCharacters[index - 1] ?? ''
      scheduleGreetingStep(
        () => typeGreeting(index + 1),
        /[，。、！？…—]/u.test(character) ? 170 : 54
      )
    } else {
      greetingAnimationComplete.value = true
    }
  }

  typeGreeting(1)
}


onMounted(() => {
  void window.comicType.storeGet('ui.userId').then(value => { if (greetingMounted && typeof value === 'string' && value.trim()) userIdDisplay.value = value.trim().slice(0,40) }).catch(() => undefined)
  greetingMounted = true; initializePlexus(); scheduleGreetingRefresh(); runGreetingAnimation()
})
onBeforeUnmount(() => { greetingMounted = false; clearGreetingTimers(); if(clockTimer !== undefined) window.clearTimeout(clockTimer); destroyPlexus() })
watch([greetingText,userIdDisplay], () => { if(greetingMounted) runGreetingAnimation() })
</script>
<template>
 <section class="home-greeting relative overflow-hidden" data-testid="dashboard-greeting" @pointermove="onGreetingPointerMove" @pointerleave="onGreetingPointerLeave">
  <canvas ref="plexusCanvas" class="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
  <div class="relative flex min-w-0 flex-col gap-3 py-5">
   <p class="text-base font-bold text-muted-foreground">{{ greetingSalutation(currentClock) }}，<span class="text-primary">{{ userIdDisplay }}</span></p>
   <p class="greeting-copy font-semibold" :aria-label="greetingText" data-testid="dashboard-greeting-text"><span aria-hidden="true" v-for="(clause,index) in animatedGreeting.split('\n')" :key="index" class="inline-block">{{ clause }}</span><span v-if="greetingAnimationComplete" class="greeting-cursor text-primary" aria-hidden="true"></span></p>
  </div>
 </section>
</template>
<style scoped>
.home-greeting {min-height:124px;}
.greeting-copy {font-size:24px;line-height:1.5;min-height:36px;overflow-wrap:anywhere;}
.greeting-cursor {display:inline-block;width:.5em;height:3px;margin-left:.2em;background:currentColor;vertical-align:baseline;animation:greeting-blink 2s steps(1,end) infinite;}
@keyframes greeting-blink {0%,100% {opacity:1;} 50% {opacity:0;}}
@media (prefers-reduced-motion:reduce) {.greeting-cursor {animation:none;}}
@container (max-width:640px) {.greeting-copy {font-size:20px;}}
</style>
