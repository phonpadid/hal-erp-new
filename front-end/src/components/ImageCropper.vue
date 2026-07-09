<script setup lang="ts">
import Button from 'primevue/button';
import Slider from 'primevue/slider';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(defineProps<{ file: File; output?: number; viewport?: number }>(), {
  output: 400, // exported square edge in px
  viewport: 280, // on-screen square edge in px
});
const emit = defineEmits<{ cropped: [blob: Blob]; cancel: [] }>();

const { t } = useI18n();

const canvas = ref<HTMLCanvasElement | null>(null);
const img = new Image();
let objectUrl = '';
let iw = 0;
let ih = 0;

const V = props.viewport;
const scale = ref(1); // current image scale (viewport units)
const minScale = ref(1);
const zoom = ref(0); // slider 0..100 → minScale..minScale*3
const offset = ref({ x: 0, y: 0 }); // image top-left in viewport coords
const ready = ref(false);

let dragging = false;
let last = { x: 0, y: 0 };

function clampOffset() {
  const w = iw * scale.value;
  const h = ih * scale.value;
  // Keep the image covering the viewport (offsets between V - size and 0).
  offset.value.x = Math.min(0, Math.max(V - w, offset.value.x));
  offset.value.y = Math.min(0, Math.max(V - h, offset.value.y));
}

function draw() {
  const c = canvas.value;
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, V, V);
  ctx.drawImage(img, offset.value.x, offset.value.y, iw * scale.value, ih * scale.value);
}

function applyZoom(next: number) {
  const old = scale.value;
  const s = minScale.value * (1 + (next / 100) * 2); // minScale .. minScale*3
  // Keep the viewport centre pinned to the same image point while zooming.
  const cx = (V / 2 - offset.value.x) / old;
  const cy = (V / 2 - offset.value.y) / old;
  scale.value = s;
  offset.value.x = V / 2 - cx * s;
  offset.value.y = V / 2 - cy * s;
  clampOffset();
  draw();
}

function onPointerDown(e: PointerEvent) {
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return;
  offset.value.x += e.clientX - last.x;
  offset.value.y += e.clientY - last.y;
  last = { x: e.clientX, y: e.clientY };
  clampOffset();
  draw();
}
function onPointerUp() {
  dragging = false;
}

function confirm() {
  const out = document.createElement('canvas');
  out.width = props.output;
  out.height = props.output;
  const ctx = out.getContext('2d');
  if (!ctx) {
    emit('cancel');
    return;
  }
  const k = props.output / V;
  ctx.drawImage(img, offset.value.x * k, offset.value.y * k, iw * scale.value * k, ih * scale.value * k);
  out.toBlob((blob) => {
    if (blob) emit('cropped', blob);
    else emit('cancel');
  }, 'image/png');
}

onMounted(() => {
  objectUrl = URL.createObjectURL(props.file);
  img.onload = () => {
    iw = img.naturalWidth || 1;
    ih = img.naturalHeight || 1;
    minScale.value = V / Math.min(iw, ih); // cover the square viewport
    scale.value = minScale.value;
    zoom.value = 0;
    offset.value = { x: (V - iw * scale.value) / 2, y: (V - ih * scale.value) / 2 };
    ready.value = true;
    // Wait a tick so the canvas ref is bound before the first draw.
    requestAnimationFrame(draw);
  };
  img.src = objectUrl;
});

onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});
</script>

<template>
  <div class="flex flex-col items-center gap-4">
    <!-- Square 1:1 crop viewport with a circular grab affordance. -->
    <div
      class="relative overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 touch-none select-none"
      :style="{ width: V + 'px', height: V + 'px' }"
    >
      <canvas
        ref="canvas"
        :width="V"
        :height="V"
        class="cursor-move"
        data-testid="cropper-canvas"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
      />
      <div class="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/40" />
    </div>

    <div class="flex items-center gap-3 w-full" :style="{ maxWidth: V + 'px' }">
      <i class="pi pi-search-minus text-muted-color" />
      <Slider v-model="zoom" :min="0" :max="100" class="flex-1" @update:modelValue="applyZoom($event as number)" />
      <i class="pi pi-search-plus text-muted-color" />
    </div>

    <div class="flex justify-end gap-2 w-full" :style="{ maxWidth: V + 'px' }">
      <Button :label="t('common.cancel')" severity="secondary" text @click="emit('cancel')" />
      <Button :label="t('common.imageUpload.cropConfirm')" icon="pi pi-check" :disabled="!ready" data-testid="cropper-confirm" @click="confirm" />
    </div>
  </div>
</template>
