<script setup lang="ts">
import { computed } from 'vue'
import type { FontPreviewResult } from '@shared/ipc-api'
const props=defineProps<{sample:FontPreviewResult;size:number}>()
const positioned=computed(()=>{let x=0;return (props.sample.glyphs??[]).map(g=>{const item={...g,x};x+=g.width;return item})})
const bounds=computed(()=>props.sample.bounds??{left:0,top:props.sample.ascent??1000,width:positioned.value.reduce((n,g)=>n+g.width,0),height:(props.sample.ascent??1000)-(props.sample.descent??0)})
</script>
<template>
 <svg class="glyph-sample" role="img" aria-label="嵌字工坊 字体预览 123 ABC" :viewBox="`${bounds.left} 0 ${bounds.width} ${bounds.height}`" preserveAspectRatio="xMidYMid meet" :style="{maxWidth:`${bounds.width/(sample.unitsPerEm||1000)*size}px`,maxHeight:`${bounds.height/(sample.unitsPerEm||1000)*size}px`}">
  <path v-for="(glyph,index) in positioned" :key="index" :d="glyph.path" :transform="`translate(${glyph.x} ${bounds.top}) scale(1 -1)`" fill="currentColor" />
 </svg>
</template>
<style scoped>.glyph-sample{width:100%;height:100%;min-width:0;min-height:0;flex:1;display:block}</style>
