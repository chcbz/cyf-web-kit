<template>
  <span class="bounty-action-icon" aria-hidden="true">
    <svg viewBox="0 0 32 32" focusable="false">
      <g v-if="name === 'refresh'">
        <path d="M8.5 11.5a8.6 8.6 0 0 1 13.4-3.2l1.9 1.7" />
        <path d="M23.8 5.8v4.7h-4.7" />
        <path d="M23.5 20.5a8.6 8.6 0 0 1-13.4 3.2l-1.9-1.7" />
        <path d="M8.2 26.2v-4.7h4.7" />
        <path class="accent-fill" d="M15.2 10.2h4.5l-2.1 3.9h-4.5z" />
      </g>

      <g v-else-if="name === 'plus'">
        <path d="M8.5 22.6h15" />
        <path d="M10.2 9.3h11.6l2.1 13.3H8.1z" />
        <path d="M16 12.7v7" />
        <path d="M12.5 16.2h7" />
        <path class="accent" d="M11.4 7.7c2.2-1.3 6.9-1.3 9.2 0" />
      </g>

      <g v-else-if="name === 'close'">
        <path d="M9.4 9.4 22.6 22.6" />
        <path d="M22.6 9.4 9.4 22.6" />
        <path class="accent" d="M8 16c0-4.7 3.3-8 8-8s8 3.3 8 8-3.3 8-8 8-8-3.3-8-8z" />
      </g>

      <g v-else-if="name === 'assign'">
        <path d="M9.5 23.8c1.2-4.2 3.3-6.3 6.5-6.3s5.3 2.1 6.5 6.3" />
        <path d="M11.3 13.2c.5-3.5 2.2-5.3 4.7-5.3s4.2 1.8 4.7 5.3" />
        <path d="M10.5 13.5c2.4 1.5 8.6 1.5 11 0" />
        <path d="M16 4.5v4.2" />
        <path class="accent-fill" d="M13.3 4.8 16 3l2.7 1.8L16 6.2z" />
      </g>

      <g v-else-if="name === 'whisper'">
        <path d="M8.4 11.2c0-2.3 2.3-4.1 5.1-4.1s5.1 1.8 5.1 4.1-2.3 4.1-5.1 4.1c-.6 0-1.2-.1-1.8-.2l-3.1 1.8.8-3c-.6-.7-1-1.6-1-2.7z" />
        <path d="M14.2 19.8c.8 1.8 2.9 3.1 5.3 3.1.7 0 1.4-.1 2-.3l3.1 1.8-.8-3c.7-.8 1.1-1.7 1.1-2.8 0-1.9-1.5-3.5-3.7-4.1" />
        <path class="accent" d="M11.5 11.2h3.8" />
      </g>

      <g v-else-if="name === 'group'">
        <path d="M8.6 8.2h12.9c1.2 0 2.1.9 2.1 2.1v13.5H9.8c-1.2 0-2.2-1-2.2-2.2V9.2c0-.6.4-1 1-1z" />
        <path d="M11.4 13.2h7.4" />
        <path d="M11.4 17h8.9" />
        <path d="M11.4 20.8h5.1" />
        <path class="accent" d="m20.3 12.7 1.1 1.2 2.4-2.6" />
      </g>

      <g v-else-if="name === 'strategist'">
        <path d="M9.2 22.8c3.5-7.2 7.3-12 13.7-15.2" />
        <path d="M10.2 20.4c3.4-1 8.3-4.6 12.6-11.5" />
        <path d="M12.5 24.5c2.9-1 7.9-3.5 11.3-12.2" />
        <path d="M7.8 24.7c2.6 1.6 7.3 1.7 11.5-.2" />
        <path class="accent-fill" d="M21.3 5.7 25 4.6l-.9 3.8z" />
      </g>

      <g v-else-if="name === 'discuss'">
        <path d="M8.3 14.4c0-3.7 3.6-6.7 8-6.7s8 3 8 6.7-3.6 6.7-8 6.7c-.8 0-1.6-.1-2.3-.3l-4.3 2.5 1.2-4c-1.6-1.2-2.6-2.9-2.6-4.9z" />
        <path class="accent" d="M12.6 14.4h.1" />
        <path class="accent" d="M16 14.4h.1" />
        <path class="accent" d="M19.4 14.4h.1" />
      </g>

      <g v-else-if="name === 'archive'">
        <path d="M8.1 11.3h15.8v12.4H8.1z" />
        <path d="M10.1 8.3h11.8l2 3H8.1z" />
        <path d="M12.2 16.5h7.6" />
        <path d="M12.2 20h5.3" />
        <path class="accent" d="M21.3 17.7v3.8" />
      </g>

      <g v-else-if="name === 'select'">
        <path d="M8.7 16.8 13.2 21 23.5 10.8" />
        <path class="accent" d="M8.1 23.5h15.8" />
        <path d="M10.2 8.6h11.6" />
      </g>

      <g v-else>
        <path d="M8.5 8.5h15v15h-15z" />
        <path class="accent" d="M11.5 16h9" />
      </g>
    </svg>
  </span>
</template>

<script setup>
defineProps({
  name: { type: String, required: true }
})
</script>

<style scoped>
.bounty-action-icon {
  --bounty-icon-accent: #d8a33a;
  display: inline-grid;
  place-items: center;
  width: 1.15em;
  height: 1.15em;
  flex: 0 0 auto;
  color: currentColor;
  line-height: 0;
}

.bounty-action-icon svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.bounty-action-icon path {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.bounty-action-icon .accent {
  stroke: var(--bounty-icon-accent);
}

.bounty-action-icon .accent-fill {
  fill: var(--bounty-icon-accent);
  stroke: currentColor;
  stroke-width: 1.4;
}
</style>
