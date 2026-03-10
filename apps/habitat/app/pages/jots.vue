<template>
  <div class="space-y-5">

    <header class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Jots</h2>
      <div class="flex items-center gap-1.5">
        <UButton
          :icon="gridView ? 'i-heroicons-list-bullet' : 'i-heroicons-squares-2x2'"
          size="sm"
          color="neutral"
          variant="ghost"
          :aria-label="gridView ? 'Switch to list view' : 'Switch to grid view'"
          @click="gridView = !gridView"
        />
        <UButton icon="i-heroicons-plus" size="sm" @click="activeModal = 'picker'">New</UButton>
      </div>
    </header>

    <!-- Error -->
    <UAlert
      v-if="errorMsg"
      :title="errorMsg"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-circle"
      :close-button="{ icon: 'i-heroicons-x-mark', color: 'error', variant: 'ghost', size: 'sm' }"
      @close="errorMsg = null"
    />

    <!-- Empty state -->
    <section
      v-if="timeline.length === 0"
      class="flex flex-col items-center justify-center gap-4 py-12 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-(--ui-bg-elevated) flex items-center justify-center">
        <UIcon name="i-heroicons-document-text" class="w-8 h-8 text-(--ui-text-muted)" />
      </div>
      <div class="space-y-1">
        <p class="font-semibold text-(--ui-text)">No jots yet</p>
        <p class="text-sm text-(--ui-text-dimmed)">Tap New to add a text note, voice recording, or photo.</p>
      </div>
    </section>

    <!-- ── List view ─────────────────────────────────────────────────────── -->
    <ul v-else-if="!gridView" class="space-y-2">
      <template v-for="item in timeline" :key="item.kind + '-' + item.data.id">

        <!-- Text jot -->
        <li
          v-if="item.kind === 'text'"
          class="p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border) active:opacity-70 transition-opacity cursor-pointer"
          @click="openEditText(item.data)"
        >
          <div class="flex items-start gap-2.5">
            <div class="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center mt-0.5 shrink-0">
              <UIcon name="i-heroicons-pencil" class="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <p class="font-medium text-sm text-(--ui-text) leading-snug">{{ previewTitle(item.data) }}</p>
                <span class="text-[11px] text-slate-600 shrink-0 mt-0.5">{{ timeAgo(item.data.updated_at) }}</span>
              </div>
              <p v-if="previewBody(item.data)" class="text-xs text-(--ui-text-dimmed) mt-0.5 line-clamp-2">{{ previewBody(item.data) }}</p>
              <div v-if="item.data.tags.length > 0" class="flex flex-wrap gap-1 mt-2">
                <span
                  v-for="tag in item.data.tags.slice(0, 5)"
                  :key="tag"
                  class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px]
                         text-(--ui-text-muted) bg-(--ui-bg-elevated) border border-(--ui-border-accented)"
                >
                  <span v-if="splitTag(tag).parent" class="text-slate-600">{{ splitTag(tag).parent }}/</span>
                  <span>{{ splitTag(tag).leaf }}</span>
                </span>
                <span v-if="item.data.tags.length > 5" class="text-[10px] text-slate-600 self-center pl-0.5">+{{ item.data.tags.length - 5 }}</span>
              </div>
            </div>
            <button
              class="shrink-0 self-start mt-0.5 p-1 rounded-lg transition-colors"
              :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
              :title="hasLinkedTodo(item.data.id) ? 'View linked TODO' : 'Create TODO for this jot'"
              @click.stop="onJotLinkClick(item)"
            >
              <UIcon :name="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'" class="w-3.5 h-3.5" />
            </button>
          </div>
        </li>

        <!-- Voice jot -->
        <li
          v-else-if="item.kind === 'voice'"
          class="p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border)"
        >
          <div class="flex items-center gap-3">
            <div class="w-6 h-6 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
              <UIcon name="i-heroicons-microphone" class="w-3.5 h-3.5 text-rose-400" />
            </div>
            <UButton
              :icon="currentlyPlaying === item.data.id ? 'i-heroicons-pause' : 'i-heroicons-play'"
              :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
              :variant="currentlyPlaying === item.data.id ? 'soft' : 'outline'"
              size="sm"
              :ui="{ base: 'rounded-full' }"
              :disabled="transcribingExistingId === item.data.id"
              @click="transcribingExistingId === item.data.id ? undefined : togglePlay(item.data)"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-(--ui-text-toned) truncate">{{ fmtDate(item.data.created_at, appSettings.use24HourTime) }}</p>
              <p
                class="text-xs tabular-nums"
                :class="transcribingExistingId === item.data.id ? 'text-primary-400 animate-pulse' : 'text-(--ui-text-dimmed)'"
              >
                {{ transcribingExistingId === item.data.id ? 'Transcribing…' : fmtDuration(item.data.duration) }}
              </p>
            </div>
            <UButton
              v-if="speechSupported"
              icon="i-heroicons-language"
              color="neutral"
              variant="ghost"
              size="sm"
              class="text-slate-600 hover:text-primary-400"
              :loading="transcribingExistingId === item.data.id"
              :disabled="!!transcribingExistingId && transcribingExistingId !== item.data.id"
              @click="transcribeNote(item.data)"
            />
            <UButton
              :icon="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'"
              color="neutral"
              variant="ghost"
              size="sm"
              :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
              :title="hasLinkedTodo(item.data.id) ? 'View linked TODO' : 'Create TODO for this jot'"
              :disabled="transcribingExistingId === item.data.id"
              @click="onJotLinkClick(item)"
            />
            <UButton
              icon="i-heroicons-trash"
              color="neutral"
              variant="ghost"
              size="sm"
              class="text-slate-600 hover:text-red-400"
              :disabled="transcribingExistingId === item.data.id"
              @click="deleteVoiceNote(item.data)"
            />
          </div>
        </li>

        <!-- Image jot -->
        <li
          v-else-if="item.kind === 'image'"
          class="p-3 rounded-xl bg-(--ui-bg-muted) border border-(--ui-border)"
        >
          <div class="flex items-center gap-3">
            <div class="w-6 h-6 rounded-full bg-sky-500/10 flex items-center justify-center shrink-0">
              <UIcon name="i-heroicons-photo" class="w-3.5 h-3.5 text-sky-400" />
            </div>
            <img
              v-if="item.data.url"
              :src="item.data.url"
              :alt="item.data.filename"
              class="w-16 h-16 object-cover rounded-lg shrink-0"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-(--ui-text-toned) truncate">{{ item.data.filename }}</p>
              <p class="text-xs text-(--ui-text-dimmed)">{{ fmtDate(item.data.created_at, appSettings.use24HourTime) }}</p>
            </div>
            <UButton
              :icon="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'"
              color="neutral"
              variant="ghost"
              size="sm"
              :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
              :title="hasLinkedTodo(item.data.id) ? 'View linked TODO' : 'Create TODO for this jot'"
              @click="onJotLinkClick(item)"
            />
            <UButton
              icon="i-heroicons-trash"
              color="neutral"
              variant="ghost"
              size="sm"
              class="text-slate-600 hover:text-red-400"
              @click="deleteImageNote(item.data)"
            />
          </div>
        </li>

      </template>
    </ul>

    <!-- ── Grid view ──────────────────────────────────────────────────────── -->
    <ul v-else class="jots-masonry">
      <template v-for="item in timeline" :key="item.kind + '-' + item.data.id">

        <!-- Text tile (Google Keep card) -->
        <li
          v-if="item.kind === 'text'"
          class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) overflow-hidden cursor-pointer active:scale-[0.97] transition-transform"
          @click="openEditText(item.data)"
        >
          <!-- Left accent bar + content -->
          <div class="flex">
            <div class="w-[3px] shrink-0 rounded-l-2xl bg-gradient-to-b from-amber-500/80 to-amber-600/30" />
            <div class="p-3 flex flex-col gap-2 min-w-0 flex-1">
              <p class="font-semibold text-sm text-(--ui-text) leading-snug line-clamp-2">
                {{ previewTitle(item.data) }}
              </p>
              <p v-if="gridBody(item.data)" class="text-xs text-(--ui-text-dimmed) line-clamp-6 leading-relaxed">
                {{ gridBody(item.data) }}
              </p>
              <div class="flex items-end justify-between gap-1 mt-auto pt-1">
                <div class="flex flex-wrap gap-1 min-w-0">
                  <span
                    v-for="tag in item.data.tags.slice(0, 2)"
                    :key="tag"
                    class="px-1.5 py-0.5 rounded-full text-[9px] bg-(--ui-bg-elevated) text-(--ui-text-dimmed) border border-(--ui-border-accented)/60 truncate max-w-[72px]"
                  >{{ splitTag(tag).leaf }}</span>
                  <span v-if="item.data.tags.length > 2" class="text-[9px] text-slate-600 self-center">+{{ item.data.tags.length - 2 }}</span>
                </div>
                <div class="flex items-center gap-0.5 shrink-0">
                  <button
                    class="p-0.5 rounded transition-colors"
                    :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                    :title="hasLinkedTodo(item.data.id) ? 'View linked TODO' : 'Create TODO for this jot'"
                    @click.stop="onJotLinkClick(item)"
                  >
                    <UIcon :name="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'" class="w-3 h-3" />
                  </button>
                  <span class="text-[10px] text-slate-600">{{ timeAgo(item.data.updated_at) }}</span>
                </div>
              </div>
            </div>
          </div>
        </li>

        <!-- Voice tile (Windows-style tile) -->
        <li
          v-else-if="item.kind === 'voice'"
          class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) overflow-hidden"
        >
          <div class="h-0.5 bg-gradient-to-r from-rose-500/70 to-rose-600/30" />
          <div class="p-3 flex flex-col items-center gap-2.5 text-center">
            <!-- Big mic icon — tile aesthetic -->
            <div class="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mt-1">
              <UIcon name="i-heroicons-microphone" class="w-6 h-6 text-rose-400" />
            </div>
            <!-- Duration + date -->
            <div>
              <p
                class="text-sm font-mono tabular-nums font-medium"
                :class="transcribingExistingId === item.data.id ? 'text-primary-400 animate-pulse' : 'text-(--ui-text-toned)'"
              >
                {{ transcribingExistingId === item.data.id ? '…' : fmtDuration(item.data.duration) }}
              </p>
              <p class="text-[10px] text-slate-600 mt-0.5">{{ timeAgo(item.data.created_at) }}</p>
            </div>
            <!-- Play button -->
            <UButton
              :icon="currentlyPlaying === item.data.id ? 'i-heroicons-pause' : 'i-heroicons-play'"
              :color="currentlyPlaying === item.data.id ? 'primary' : 'neutral'"
              :variant="currentlyPlaying === item.data.id ? 'soft' : 'outline'"
              size="xs"
              :ui="{ base: 'rounded-full' }"
              :disabled="transcribingExistingId === item.data.id"
              @click.stop="transcribingExistingId === item.data.id ? undefined : togglePlay(item.data)"
            />
            <!-- Actions -->
            <div class="flex items-center gap-0.5 pb-1">
              <UButton
                v-if="speechSupported"
                icon="i-heroicons-language"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-slate-600 hover:text-primary-400"
                :loading="transcribingExistingId === item.data.id"
                :disabled="!!transcribingExistingId && transcribingExistingId !== item.data.id"
                @click.stop="transcribeNote(item.data)"
              />
              <UButton
                :icon="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'"
                color="neutral"
                variant="ghost"
                size="xs"
                :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                :title="hasLinkedTodo(item.data.id) ? 'View linked TODO' : 'Create TODO for this jot'"
                :disabled="transcribingExistingId === item.data.id"
                @click.stop="onJotLinkClick(item)"
              />
              <UButton
                icon="i-heroicons-trash"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-slate-600 hover:text-red-400"
                :disabled="transcribingExistingId === item.data.id"
                @click.stop="deleteVoiceNote(item.data)"
              />
            </div>
          </div>
        </li>

        <!-- Image tile -->
        <li
          v-else-if="item.kind === 'image'"
          class="rounded-2xl bg-(--ui-bg-muted) border border-(--ui-border) overflow-hidden"
        >
          <!-- Image fills top -->
          <img
            v-if="item.data.url"
            :src="item.data.url"
            :alt="item.data.filename"
            class="w-full object-cover rounded-t-2xl"
          />
          <div v-else class="w-full aspect-[4/3] bg-(--ui-bg-elevated) flex items-center justify-center rounded-t-2xl">
            <UIcon name="i-heroicons-photo" class="w-8 h-8 text-slate-600" />
          </div>
          <!-- Footer -->
          <div class="px-2.5 py-2 flex items-center justify-between gap-1">
            <div class="min-w-0">
              <p class="text-[11px] text-(--ui-text-muted) truncate leading-tight">{{ item.data.filename }}</p>
              <p class="text-[10px] text-slate-600 mt-0.5">{{ timeAgo(item.data.created_at) }}</p>
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button
                class="p-0.5 rounded transition-colors"
                :class="hasLinkedTodo(item.data.id) ? 'text-primary-400' : 'text-slate-600 hover:text-primary-400'"
                :title="hasLinkedTodo(item.data.id) ? 'View linked TODO' : 'Create TODO for this jot'"
                @click="onJotLinkClick(item)"
              >
                <UIcon :name="hasLinkedTodo(item.data.id) ? 'i-heroicons-paper-clip' : 'i-heroicons-link'" class="w-3 h-3" />
              </button>
              <UButton
                icon="i-heroicons-trash"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-slate-600 hover:text-red-400 shrink-0"
                @click="deleteImageNote(item.data)"
              />
            </div>
          </div>
        </li>

      </template>
    </ul>

    <!-- ── Type picker modal ──────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="activeModal === 'picker'" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeModal" />
        <div class="relative w-full sm:max-w-sm bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-3">
          <h3 class="text-base font-semibold text-center">New Jot</h3>
          <div class="grid grid-cols-3 gap-3">
            <button
              class="flex flex-col items-center gap-2 p-4 rounded-2xl bg-(--ui-bg-elevated) border border-(--ui-border-accented) active:opacity-70 transition-opacity"
              @click="openNewText"
            >
              <div class="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <UIcon name="i-heroicons-pencil" class="w-5 h-5 text-amber-400" />
              </div>
              <span class="text-xs text-(--ui-text-toned)">Text</span>
            </button>
            <button
              class="flex flex-col items-center gap-2 p-4 rounded-2xl bg-(--ui-bg-elevated) border border-(--ui-border-accented) active:opacity-70 transition-opacity"
              @click="activeModal = 'record'"
            >
              <div class="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center">
                <UIcon name="i-heroicons-microphone" class="w-5 h-5 text-rose-400" />
              </div>
              <span class="text-xs text-(--ui-text-toned)">Voice</span>
            </button>
            <button
              class="flex flex-col items-center gap-2 p-4 rounded-2xl bg-(--ui-bg-elevated) border border-(--ui-border-accented) active:opacity-70 transition-opacity"
              @click="activeModal = 'image'"
            >
              <div class="w-10 h-10 rounded-full bg-sky-500/10 flex items-center justify-center">
                <UIcon name="i-heroicons-photo" class="w-5 h-5 text-sky-400" />
              </div>
              <span class="text-xs text-(--ui-text-toned)">Image</span>
            </button>
          </div>
          <div class="safe-area-bottom" aria-hidden="true" />
        </div>
      </div>
    </Teleport>

    <!-- ── Text modal ─────────────────────────────────────────────────────── -->
    <UModal :open="activeModal === 'text'" @update:open="v => { if (!v) closeModal() }">
      <template #content>
        <div class="flex flex-col max-h-[90dvh]">

          <div class="flex items-center justify-between px-4 pt-4 pb-3 border-b border-(--ui-border) shrink-0">
            <h3 class="text-base font-semibold">{{ textEditing ? 'Edit Jot' : 'New Jot' }}</h3>
            <div class="flex items-center gap-2">
              <span v-if="textEditing" class="text-[11px] text-slate-600">
                Created {{ timeAgo(textEditing.created_at) }}
              </span>
              <UButton
                v-if="textEditing"
                icon="i-heroicons-trash"
                color="error"
                variant="ghost"
                size="sm"
                @click="deleteText"
              />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto px-4 pt-3 pb-2 space-y-3 min-h-0">

            <input
              v-model="textForm.title"
              placeholder="Title (optional)"
              class="w-full bg-transparent text-base font-medium text-(--ui-text)
                     placeholder-slate-600 outline-none border-0"
            />

            <div class="border-t border-(--ui-border)/60" />

            <UTextarea
              v-model="textForm.content"
              placeholder="Start writing…"
              autoresize
              :rows="6"
              variant="none"
              class="w-full"
              :ui="{ base: 'resize-none bg-transparent text-(--ui-text) placeholder-slate-600 text-sm leading-relaxed' }"
            />

            <div class="border-t border-(--ui-border) pt-3 space-y-2">
              <p class="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Tags</p>
              <div class="flex flex-wrap items-center gap-1.5 min-h-[20px]">
                <span
                  v-for="tag in textForm.tags"
                  :key="tag"
                  class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px]
                         bg-(--ui-bg-elevated) text-(--ui-text-toned) border border-(--ui-border-accented)"
                >
                  <span v-if="splitTag(tag).parent" class="text-(--ui-text-dimmed)">{{ splitTag(tag).parent }}/</span>
                  {{ splitTag(tag).leaf }}
                  <button
                    class="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full
                           text-(--ui-text-dimmed) hover:text-(--ui-text) hover:bg-(--ui-bg-accented) transition-colors"
                    @click.stop="removeTag(tag)"
                  >×</button>
                </span>
                <input
                  v-model="tagInput"
                  placeholder="+ add tag"
                  class="text-[11px] bg-transparent text-(--ui-text-muted) placeholder-slate-600
                         outline-none border-0 min-w-0 w-20"
                  @keydown="onTagKeydown"
                  @blur="commitTag"
                />
              </div>
            </div>

            <div class="border-t border-(--ui-border) pt-3 pb-1">
              <button
                class="text-xs text-(--ui-text-dimmed) hover:text-(--ui-text-muted) flex items-center gap-1.5 transition-colors"
                @click="annotExpanded = !annotExpanded"
              >
                <UIcon
                  :name="annotExpanded ? 'i-heroicons-chevron-down' : 'i-heroicons-tag'"
                  class="w-3.5 h-3.5"
                />
                <span v-if="annotationCount > 0">
                  {{ annotationCount }} annotation{{ annotationCount !== 1 ? 's' : '' }}
                </span>
                <span v-else>{{ annotExpanded ? 'Hide annotations' : 'Add annotations' }}</span>
              </button>

              <div v-if="annotExpanded" class="mt-2 space-y-2">
                <div
                  v-for="(val, key) in textForm.annotations"
                  :key="key"
                  class="flex items-center gap-2"
                >
                  <span class="text-[11px] text-(--ui-text-dimmed) font-mono shrink-0">{{ key }}</span>
                  <span class="text-[11px] text-(--ui-text-muted) flex-1 min-w-0 truncate">{{ val }}</span>
                  <UButton
                    icon="i-heroicons-x-mark"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="text-slate-600 hover:text-red-400 shrink-0"
                    @click="removeAnnot(String(key))"
                  />
                </div>
                <div class="flex items-center gap-1.5">
                  <UInput
                    v-model="newAnnotKey"
                    placeholder="key"
                    size="xs"
                    variant="outline"
                    class="flex-1"
                    @keydown.enter="commitAnnot"
                  />
                  <UInput
                    v-model="newAnnotVal"
                    placeholder="value"
                    size="xs"
                    variant="outline"
                    class="flex-1"
                    @keydown.enter="commitAnnot"
                  />
                  <UButton size="xs" variant="soft" color="neutral" @click="commitAnnot">Add</UButton>
                </div>
              </div>
            </div>

          </div>

          <div class="flex justify-end gap-2 px-4 py-3 border-t border-(--ui-border) shrink-0">
            <UButton variant="ghost" color="neutral" @click="closeModal">Cancel</UButton>
            <UButton
              :loading="textSaving"
              :disabled="textSaving || !canSaveText"
              @click="saveText"
            >
              {{ textEditing ? 'Save' : 'Create' }}
            </UButton>
          </div>

        </div>
      </template>
    </UModal>

    <!-- ── Record modal ────────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="activeModal === 'record'" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" @click="() => { if (!recording) closeModal() }" />
        <div class="relative w-full sm:max-w-md bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-4">

          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">Voice Note</h3>
            <UButton
              v-if="!recording"
              icon="i-heroicons-x-mark"
              variant="ghost"
              color="neutral"
              size="sm"
              @click="closeModal"
            />
          </div>

          <div class="flex flex-col items-center gap-3 py-4">
            <button
              class="w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              :class="recording
                ? 'bg-red-500 shadow-xl shadow-red-500/30 scale-105'
                : 'bg-(--ui-bg-elevated) hover:bg-(--ui-bg-accented)'"
              :aria-label="recording ? 'Stop recording' : 'Start recording'"
              @click="toggleRecording"
            >
              <UIcon
                :name="recording ? 'i-heroicons-stop' : 'i-heroicons-microphone'"
                class="w-10 h-10"
                :class="recording ? 'text-white' : 'text-(--ui-text-toned)'"
              />
            </button>

            <p v-if="recording" class="text-red-400 text-sm font-mono tabular-nums animate-pulse">
              ● {{ fmtDuration(recordingSeconds) }}
            </p>
            <p v-else-if="transcriptionPending" class="text-xs text-primary-400 animate-pulse">
              Finishing transcription…
            </p>
            <p v-else class="text-xs text-(--ui-text-dimmed)">Tap to record</p>

            <div
              v-if="recording && speechSupported && (finalTranscript || interimTranscript)"
              class="w-full max-w-sm bg-(--ui-bg-elevated)/60 rounded-2xl px-4 py-3 text-sm text-(--ui-text-toned) min-h-[3rem]"
            >
              <span>{{ finalTranscript }}</span>
              <span class="text-(--ui-text-dimmed) italic">{{ interimTranscript }}</span>
            </div>
          </div>

          <div class="safe-area-bottom" aria-hidden="true" />
        </div>
      </div>
    </Teleport>

    <!-- ── Image picker modal ─────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="activeModal === 'image'" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" @click="() => { cancelImagePreview(); closeModal() }" />
        <div class="relative w-full sm:max-w-md bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-4">

          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">Add Image</h3>
            <UButton
              icon="i-heroicons-x-mark"
              variant="ghost"
              color="neutral"
              size="sm"
              @click="() => { cancelImagePreview(); closeModal() }"
            />
          </div>

          <!-- Preview -->
          <div v-if="imagePreviewing" class="space-y-3">
            <img
              :src="imagePreviewing.url"
              :alt="imagePreviewing.filename"
              class="w-full max-h-64 object-contain rounded-xl bg-(--ui-bg-elevated)"
            />
            <p class="text-xs text-(--ui-text-dimmed) truncate">{{ imagePreviewing.filename }}</p>
            <div class="flex gap-2">
              <UButton class="flex-1" @click="saveImage">Save</UButton>
              <UButton variant="outline" color="neutral" @click="cancelImagePreview">Choose another</UButton>
            </div>
          </div>

          <!-- Picker buttons -->
          <div v-else class="grid grid-cols-2 gap-3">
            <label
              class="flex flex-col items-center gap-2 p-5 rounded-2xl bg-(--ui-bg-elevated) border border-(--ui-border-accented) cursor-pointer active:opacity-70 transition-opacity"
            >
              <UIcon name="i-heroicons-photo" class="w-8 h-8 text-sky-400" />
              <span class="text-sm text-(--ui-text-toned)">Gallery</span>
              <input
                type="file"
                accept="image/*"
                class="sr-only"
                @change="handleFileInput"
              />
            </label>
            <label
              class="flex flex-col items-center gap-2 p-5 rounded-2xl bg-(--ui-bg-elevated) border border-(--ui-border-accented) cursor-pointer active:opacity-70 transition-opacity"
            >
              <UIcon name="i-heroicons-camera" class="w-8 h-8 text-sky-400" />
              <span class="text-sm text-(--ui-text-toned)">Camera</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                class="sr-only"
                @change="handleFileInput"
              />
            </label>
          </div>

          <div class="safe-area-bottom" aria-hidden="true" />
        </div>
      </div>
    </Teleport>

    <!-- ── Transcript save modal ───────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="activeModal === 'transcript'" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeTranscriptModal" />
        <div class="relative w-full sm:max-w-md bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto overscroll-contain">

          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold">Save transcription</h3>
            <UButton icon="i-heroicons-x-mark" variant="ghost" color="neutral" size="sm" @click="closeTranscriptModal" />
          </div>

          <div class="space-y-1">
            <label class="text-xs text-(--ui-text-dimmed) font-medium">Title</label>
            <input
              v-model="transcriptTitle"
              type="text"
              class="w-full bg-(--ui-bg-elevated) border border-(--ui-border-accented) rounded-xl px-3 py-2 text-sm text-(--ui-text) focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <div class="space-y-1">
            <label class="text-xs text-(--ui-text-dimmed) font-medium">Transcript</label>
            <textarea
              v-model="transcriptText"
              rows="5"
              class="w-full bg-(--ui-bg-elevated) border border-(--ui-border-accented) rounded-xl px-3 py-2 text-sm text-(--ui-text) focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
            />
          </div>

          <label v-if="transcribingNoteId" class="flex items-center gap-2 cursor-pointer">
            <input v-model="deleteAfterTranscribe" type="checkbox" class="rounded border-(--ui-border-accented) bg-(--ui-bg-elevated) text-primary-500 focus:ring-primary-500" />
            <span class="text-sm text-(--ui-text-muted)">Delete voice recording after saving</span>
          </label>

          <div class="flex gap-2">
            <UButton
              class="flex-1"
              color="primary"
              :loading="savingTranscript"
              @click="saveTranscript"
            >
              Save to Jots
            </UButton>
            <UButton
              variant="outline"
              color="neutral"
              @click="closeTranscriptModal"
            >
              Discard
            </UButton>
          </div>

          <div class="safe-area-bottom" aria-hidden="true" />
        </div>
      </div>
    </Teleport>

    <!-- ── Create TODO from jot modal ────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showCreateTodoModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showCreateTodoModal = false" />
        <div class="relative w-full sm:max-w-sm bg-(--ui-bg-muted) border border-(--ui-border) rounded-t-3xl sm:rounded-2xl p-5 space-y-4">
          <h3 class="text-base font-semibold">Create TODO</h3>
          <p class="text-xs text-(--ui-text-dimmed) -mt-2">A TODO will be created and linked to this jot.</p>

          <div class="space-y-3">
            <UFormField label="Title" required>
              <UInput v-model="createTodoTitle" placeholder="Revisit: …" class="w-full" />
            </UFormField>
            <UFormField label="Due date">
              <UInput v-model="createTodoDate" type="date" class="w-full" />
            </UFormField>
          </div>

          <div class="flex gap-2 pt-1">
            <UButton variant="soft" color="neutral" class="flex-1" @click="showCreateTodoModal = false">Cancel</UButton>
            <UButton
              color="primary"
              class="flex-1"
              :loading="creatingTodo"
              :disabled="!createTodoTitle.trim()"
              @click="saveCreateTodo"
            >Create</UButton>
          </div>
          <div class="safe-area-bottom" aria-hidden="true" />
        </div>
      </div>
    </Teleport>

  </div>
  <NuxtPage :transition="{ name: 'slide-up', mode: 'out-in' }" />
</template>
