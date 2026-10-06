<template>
  <v-menu v-if="compact" location="bottom" max-height="320">
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        append-icon="mdi-chevron-down"
        :aria-label="`${label} for ${context}`"
        class="justify-space-between text-none px-2"
        :color="color"
        :disabled="items.length === 0"
        max-width="100%"
        rounded="pill"
        size="small"
        variant="tonal"
      >
        <span class="text-truncate">{{ items.find(item => item.value === modelValue)?.title || label }}</span>
      </v-btn>
    </template>

    <v-list :aria-label="label" density="compact" role="menu">
      <v-list-item
        v-for="item in items"
        :key="item.value"
        :active="item.value === modelValue"
        :aria-label="item.title"
        :disabled="item.disabled"
        role="menuitem"
        :title="item.title"
        @click="modelValue = item.value"
      />
    </v-list>
  </v-menu>

  <v-select
    v-else
    density="compact"
    hide-details
    :items="items.map(item => ({ ...item, props: { disabled: item.disabled } }))"
    :label="label"
    :model-value="modelValue"
    @update:model-value="modelValue = $event"
  />
</template>

<script setup lang="ts">
  withDefaults(defineProps<{ label: string, color?: string, context?: string, compact?: boolean, items: { title: string, value: string, disabled?: boolean }[] }>(), { compact: false, context: '', color: 'primary' })
  const modelValue = defineModel<string>({ required: true })
</script>
