# Roadmap — Intégration AI Chat de Volt (2026)

> Document de planning / architecture. **Aucun code applicatif n'a été modifié** pour produire ce plan.
> Objectif : faire passer le chat AI de Volt d'un « wrapper SSE one-shot » à un véritable assistant
> conversationnel, multimodal et actionnable, sans casser la sécurité (clés en keyring) ni le débit (streaming).

Dernière vérification du code : 2026-06-27. Références `fichier:ligne` pointant vers l'état réel du repo.

---

## 1. État des lieux vérifié dans le code

Les 8 points de l'analyse préalable ont été **confirmés un par un** en lisant le code source. Corrections et nuances signalées explicitement.

### ✅ Point 1 — Backend SSE hand-rolled mutualisé (CONFIRMÉ, avec nuance)

Les deux points d'entrée Tauri partagent les **4 mêmes fonctions provider** :

- `ai_ask_builtin_stream` (chat builtin) — `src-tauri/src/commands/extensions/management.rs:3285`
- `ext_ai_ask_stream` (AI d'extension) — `src-tauri/src/commands/extensions/management.rs:2710`

Les deux dispatchent vers :

- `ext_ai_openai_stream` — `management.rs:2804`
- `ext_ai_anthropic_stream` — `management.rs:2886`
- `ext_ai_groq_stream` — `management.rs:~2960`
- `ext_ai_huggingface_stream` — `management.rs:~3050`

Le parsing SSE est entièrement manuel via `drain_sse_lines` (`management.rs:2791`) qui découpe les lignes `data: …`.

> **Nuance** : ce ne sont pas « 4 fois la même fonction » mais 4 implémentations distinctes par provider.
> OpenAI / Groq / HuggingFace partagent la forme `chat/completions` ; Anthropic utilise `/v1/messages`
> (forme différente, `system` au top-level — `management.rs:2909-2911`). La logique de température
> (`resolve_temperature`, `management.rs:2679`) et de strip de préfixe modèle (`strip_model_prefix`, `management.rs:2698`)
> est mutualisée.

### ✅ Point 2 — OpenAI sur l'endpoint legacy + `max_tokens` (CONFIRMÉ)

`ext_ai_openai_stream` poste sur `https://api.openai.com/v1/chat/completions` (`management.rs:2835`)
avec un body contenant `"max_tokens"` (`management.rs:2827`) et `"temperature"` inconditionnel si fourni (`management.rs:2830-2832`).

**Problème de correctness** : le catalogue de modèles (`AiChatView.tsx:114-208`) propose `gpt-5.5`, `gpt-5.4`,
`o3`, `o3-mini`, etc. Or l'API OpenAI moderne attend :
- `max_completion_tokens` (et non `max_tokens`) pour GPT-5 / o-series ;
- **rejette** `temperature ≠ 1` sur les modèles de raisonnement (o-series, GPT-5 reasoning).

Conséquence : une partie du catalogue affiché est aujourd'hui **cassée ou dégradée** au runtime.
Le modèle par défaut côté code reste `gpt-4o-mini` (`management.rs:2814`), qui lui fonctionne — d'où un bug
masqué tant que l'utilisateur ne sélectionne pas un modèle récent.

### ✅ Point 3 — Pas de mémoire multi-tour (CONFIRMÉ — bug majeur)

`useAiChat.send()` (`src/features/plugins/builtin/ai-chat/hooks/useAiChat.ts:30-121`) n'envoie dans le payload IPC que :

```ts
await invoke('ai_ask_builtin_stream', {
  provider,
  prompt: userPrompt,                 // ← uniquement le tour courant
  options: { model, system },         // ← pas d'historique
  channel,
});
```

L'historique `messages[]` est bien stocké dans le state React (`useAiChat.ts:24`) pour l'affichage,
mais **jamais sérialisé** vers le backend. Côté Rust, `ext_ai_openai_stream` reconstruit
`messages = [system?, user]` (`management.rs:2817-2821`) — un seul tour utilisateur.
**Le chat a une amnésie totale** : chaque message est traité comme une conversation neuve.

### ✅ Point 4 — Pas de tools, structured output, ni vision (CONFIRMÉ)

- **Tool / function calling** : aucun champ `tools` / `tool_choice` dans les bodies (`management.rs:2824-2829` et équivalents). Le modèle ne peut déclencher aucune action Volt.
- **Structured output** : aucun `response_format` / `json_schema`.
- **Vision / multimodal** : `PromptInput` accepte pourtant les images (`accept="image/*"`, `multiple`, `maxFiles={4}`, `AiChatView.tsx:973-976`), mais `handleSubmit` ne lit que `message.text` (`AiChatView.tsx:598-606`) — **`message.files` est silencieusement droppé**. Les images sont collectées dans l'UI puis jetées. `content` reste une `string` partout (`useAiChat.ts:9`), jamais un tableau de parts.

### ✅ Point 5 — Pas de modèles locaux (CONFIRMÉ)

Les providers sont figés : `AI_KNOWN_PROVIDERS` = `openai | anthropic | groq | huggingface`
(constante dans `management.rs`, validée à `ai_ask_builtin_stream:3292`). Aucun champ de base URL
custom, aucun support Ollama / LM Studio (endpoints OpenAI-compatibles `http://localhost:11434/v1` ou `:1234/v1`).

### ✅ Point 6 — Moteur d'embeddings local existant mais non branché au chat (CONFIRMÉ)

Un vrai moteur existe : `EmbeddingEngine` (fastembed-rs, modèle `multilingual-e5-small`, 384-dim, FR+EN,
téléchargé à la demande ~120 MB) — `src-tauri/src/embeddings/mod.rs:1-76`, avec `cosine_similarity`
(`embeddings/mod.rs:210`). Le doc de tête mentionne explicitement un usage RAG « Ask my notes »
(`embeddings/mod.rs:1`) et un contrat de préfixes E5 `passage:` / `query:` (`embeddings/mod.rs:23-32`).

Mais les commandes exposées (`src-tauri/src/commands/ai/embeddings.rs`) se limitent à
`embeddings_is_ready` / `embeddings_prepare` / `embeddings_test`. L'usage réel est périphérique
(emojis custom `commands/ai/custom_emojis.rs`, notes `commands/content/notes.rs`).
**Aucun pipeline RAG n'alimente le chat AI.**

### ✅ Point 7 — Frontend déjà sur Vercel AI Elements / Streamdown (CONFIRMÉ, avec alerte version)

`package.json` :
- `ai` ^7.0.2 (`package.json:75`)
- `@ai-sdk/react` ^4.0.2 (`package.json:41`)
- `streamdown` ^2.5.0 (`package.json:97`)

Le rendu utilise les primitives AI Elements (`@/components/ai-elements/*`) + `MessageResponse`
(Streamdown) pour le markdown (`AiChatView.tsx:541-551`), et le type `ChatStatus` de `ai` (`AiChatView.tsx:47`).
Mais l'orchestration provider/streaming est **100 % hand-rolled en Rust** — on n'utilise pas `useChat`,
`streamText`, ni les providers `@ai-sdk/*`.

> **✅ Faux positif levé (audit 2026-06-27 via lockfile + doc officielle)** : il n'y a **aucune**
> incohérence de versions. `@ai-sdk/react@4.0.2` **dépend explicitement de `ai@7.0.2`**
> (`pnpm-lock.yaml:4601`) et les deux partagent `@ai-sdk/provider@4.0.0` + `@ai-sdk/provider-utils@5.0.0`
> (`pnpm-lock.yaml:4596-4601` / `6862-6867`). Les numéros 7 et 4 sont deux lignes de version distinctes
> mais publiées ensemble — c'est la paire GA officielle d'AI SDK 7 (annonce du 2026-06-25,
> https://vercel.com/blog/ai-sdk-7). Le « pré-requis bloquant » du Pari A n'existe pas : on est déjà
> sur la dernière majeure. À surveiller seulement lors d'un futur bump (garder `ai` et `@ai-sdk/react`
> bumpés ensemble + lancer `npx @ai-sdk/codemod` au passage de major).

### ✅ Point 8 — Clés API dans le keyring OS (CONFIRMÉ — à conserver)

Les clés sont lues via `keyring_store::retrieve_signed("volt:ai:key:{provider}")`
(`management.rs:3325-3326`), avec fallback préférence par extension `volt:ext:{id}:pref:{name}`
(`management.rs:2749-2750`). Elles **ne traversent jamais** la frontière JS. C'est le bon modèle, à garder tel quel.

### Bonus relevé pendant l'audit (hors des 8 points)

- **Rate limiting** : 10 req/min/extension (`AI_RATE_LIMIT_PER_MIN`, `management.rs:2645`). Côté chat builtin (`ai_ask_builtin_stream`), **aucun rate limit** n'est appliqué — seulement pour les extensions.
- **AI Profile** : le chat builtin préfixe le system prompt avec un profil persistant utilisateur (`management.rs:3315-3323`). À préserver lors du refactor multi-tour.
- **Anthropic builtin sans system dans messages, sans multi-tour** : même pour les extensions, `ext_ai_anthropic_stream` ne construit que `[{user}]` (`management.rs:2903`).

---

## 2. 🔴 Table-stakes — Corrections de correctness (à faire en premier)

> Ces items corrigent des **bugs** ou des comportements faux. Faible risque, fort impact qualité perçue.

### T1 — Mémoire multi-tour (l'amnésie du chat)

- **Impact** : 🔥 Critique. Sans ça, le « chat » n'est pas un chat. C'est le bug n°1 de l'expérience.
- **Effort** : **M**
- **Fichiers** :
  - `useAiChat.ts` — sérialiser l'historique : passer `messages` (mappés en `{role, content}`) dans le payload `invoke`, plutôt que `prompt` seul.
  - `management.rs` — `ExtAiOptions` (`:2622`) + `ext_ai_openai_stream` / `_groq_` / `_huggingface_` / `_anthropic_` : accepter un `Vec<{role, content}>` et construire `messages` à partir de l'historique au lieu de `[system, user]`.
  - Préserver l'injection AI Profile (`management.rs:3315`) en tête du `system`.
- **Dépendances** : aucune. Pré-requis logique de T4/J1/J2 (tout le reste suppose une conversation).
- **Reco** : **À faire en premier.** Définir un type partagé `ChatTurn { role, content }` (Rust `serde(rename_all="camelCase")` + TS), borner l'historique envoyé (ex. derniers N tours ou budget tokens) pour rester sous la limite 100k chars (`management.rs:2724`). Rendre la limite par-conversation, pas par-message.

### T2 — OpenAI : `max_completion_tokens` + Responses API

- **Impact** : 🔥 Élevé. Débloque GPT-5.x / o-series aujourd'hui cassés.
- **Effort** : **S** (param) → **M** (migration Responses API)
- **Fichiers** : `ext_ai_openai_stream` (`management.rs:2804-2884`).
- **Détail** :
  - Court terme (**S**) : remplacer `max_tokens` par `max_completion_tokens` ; ne plus envoyer `temperature` pour les modèles de raisonnement (o-series, GPT-5 reasoning) — la garder uniquement pour les modèles « chat » (`gpt-4o`, `gpt-5.x-chat-latest`).
  - Cible (**M**) : migrer vers la **Responses API** (`/v1/responses`), qui est l'API recommandée OpenAI 2026 (gère nativement reasoning items, tool calls, et le streaming d'events typés). Le parsing SSE devra gérer les `response.output_text.delta` au lieu de `choices[].delta.content`.
- **Dépendances** : indépendant ; mais la migration Responses API facilite J3 (reasoning tokens) et J1 (tools).
- **Reco** : faire le fix **S** immédiatement (1 ligne + garde temperature). Planifier la Responses API en même temps que J1 (tools) pour ne pas réécrire le parser deux fois.

### T3 — Images mortes : vision/multimodal de base OU retrait de l'affordance

- **Impact** : Moyen-élevé. Aujourd'hui l'UI **ment** : on peut joindre 4 images qui partent à la poubelle.
- **Effort** : **M** (implémenter) / **S** (retirer)
- **Fichiers** :
  - `AiChatView.tsx:598-606` (`handleSubmit` droppe `message.files`).
  - `useAiChat.ts:9` — `content: string` → supporter un tableau de parts `{type:'text'|'image', …}`.
  - `management.rs` providers — construire le `content` multimodal (OpenAI/Anthropic/Groq acceptent les content parts `image_url` / `image` base64).
- **Reco** : **Implémenter la vision** plutôt que retirer (le composant et les modèles vision sont déjà là). À défaut de temps, **retirer `accept`/`multiple`** de `PromptInput` (`AiChatView.tsx:973`) pour ne pas mentir à l'utilisateur. Ne jamais laisser l'état actuel.

### T4 — Rate limit + garde-fous sur le chat builtin

- **Impact** : Moyen (robustesse, coût).
- **Effort** : **S**
- **Fichiers** : `ai_ask_builtin_stream` (`management.rs:3285`) — réutiliser `ai_check_rate_limit` (`management.rs:2648`) avec une clé type `"builtin:chat"`.
- **Reco** : aligner builtin et extensions. Faible coût, évite l'emballement de coûts/API.

---

## 3. 🟡 Features haute-valeur

> Ces items transforment Volt d'un « chat dans une fenêtre » en **assistant intégré au launcher**.

### J1 — Tool / function calling (laisser le modèle agir sur Volt)

- **Impact** : 🚀 Le plus différenciant. Volt est un launcher : un assistant qui peut *chercher des fichiers,
  lancer une app, lire/écrire le presse-papier, ouvrir les settings* devient un vrai copilote desktop.
- **Effort** : **L**
- **Fichiers** :
  - Backend : nouvelle couche d'orchestration **tool-loop** (round-trip : modèle → tool_call → exécution Tauri → ré-injection résultat → modèle). Naturellement placée dans un nouveau module `commands/ai/chat.rs` plutôt que d'alourdir `management.rs` (déjà ~3500 lignes).
  - Exposer comme tools des commandes existantes : recherche fichiers (`indexer/search`), scan/lancement apps (`commands/apps.rs`, `launcher/`), presse-papier (`plugins/builtin/clipboard_manager`), quicklinks, system monitor.
  - Frontend : rendu des tool calls via AI Elements (`Tool`, `ToolInput`, `ToolOutput` existent dans la lib) ; demander confirmation utilisateur pour les actions à effet de bord (lancer une app, écrire le presse-papier).
- **Dépendances** : **T1 (multi-tour) obligatoire** (un tool-loop EST une conversation multi-tours). Profite de T2 (Responses API). Forte synergie avec le **Pari A** ci-dessous.
- **Reco** : **C'est le pari qui justifie de revoir l'orchestration.** Un tool-loop multi-provider hand-rollé en Rust (gérer les formats `tools` OpenAI vs Anthropic vs Groq + le re-streaming) est coûteux et fragile. → voir §4.

### J2 — Structured outputs (json_schema)

- **Impact** : Moyen-élevé. Fiabilise les presets (`presets.ts`) et les Quick Actions (sorties parsables : listes, JSON, diffs) ; pré-requis propre pour le tool calling.
- **Effort** : **M**
- **Fichiers** : bodies providers (`management.rs`) — ajouter `response_format: { type: 'json_schema', … }` (OpenAI/Groq) et l'équivalent Anthropic (tool unique forcé). Frontend : valider/afficher.
- **Dépendances** : indépendant, mais cohabite bien avec J1 (même refonte du body builder).
- **Reco** : livrer en même temps que J1 — c'est le même endroit de code.

### J3 — Streaming des reasoning tokens (Claude extended thinking / o-series)

- **Impact** : Moyen-élevé (UX premium, transparence). Le catalogue propose déjà des modèles de raisonnement (o3, Claude, Qwen Thinking, DeepSeek-R1).
- **Effort** : **M**
- **Fichiers** :
  - `management.rs` — Anthropic : activer `thinking: { type: 'enabled', budget_tokens }` et parser les `content_block_delta` de type `thinking`. OpenAI Responses API : parser les `reasoning` summary parts.
  - Protocole canal `AiStreamEvent` (`management.rs:~2590`) — ajouter une variante `Reasoning { text }` distincte de `Chunk`.
  - Frontend : `useAiChat.ts` (gérer le nouvel event) + AI Elements `Reasoning` / `ReasoningContent` (composant déjà fourni par la lib) pour l'affichage repliable.
- **Dépendances** : profite de T2 (Responses API). Indépendant de T1 mais cohérent après.
- **Reco** : haute valeur perçue pour effort modéré. Faire après T1+J1.

---

## 4. 🔵 Paris stratégiques

### Pari A (CENTRAL) — Où doit vivre l'orchestration ? Rust hand-rolled vs Vercel AI SDK (TS)

C'est **la** décision structurante. Elle conditionne le coût de J1/J2/J3 et de l'ajout futur de providers.

#### Option A1 — Continuer le hand-roll Rust par provider (statu quo étendu)

- **Pour** : clé API jamais exposée au JS (déjà le cas, keyring) ; un seul process réseau ; pas de dépendance JS supplémentaire ; contrôle fin.
- **Contre** : **chaque feature est multipliée par 4 providers** écrits à la main. Tool-loop multi-provider, vision content-parts, reasoning deltas, structured output, Responses API… = des centaines de lignes de parsing SSE fragile par format. `management.rs` fait déjà ~3500 lignes. La dette grandit vite et chaque nouvelle API casse silencieusement (cf. T2 déjà cassé pour GPT-5).

#### Option A2 — Adopter le Vercel AI SDK complet dans une couche TS

- **Pour** : `streamText` + providers `@ai-sdk/openai|anthropic|groq` gèrent nativement **tool calling, vision, reasoning, structured output, et toutes les nouvelles APIs (Responses incluse)** — maintenus par Vercel, pas par nous. Le frontend a **déjà** `ai`, `@ai-sdk/react`, AI Elements et Streamdown installés et utilisés pour le rendu. L'effort par feature s'effondre. Ollama/LM Studio (Pari B) = juste un `baseURL` OpenAI-compatible.
- **Boost AI SDK 7 (GA 2026-06-25)** — la version déjà installée (`ai@7.0.2`) apporte précisément les primitives de la roadmap, ce qui réduit encore l'effort de J1/J2/J3 :
  - **`ToolLoopAgent`** : boucle d'outils multi-étapes first-class → couvre J1 sans hand-roll du round-trip multi-provider.
  - **Tool context typé** (`contextSchema` / `toolsContext`) : injecter des secrets/config par-outil **sans les exposer au modèle** → aligné avec l'invariant clés.
  - **Tool approvals** : `'user-approval'` + approbations **signées HMAC** pour les actions à risque → la confirmation des effets de bord de J1, native.
  - **`reasoning: 'high'`** standardisé cross-provider → sert J3 et T2 (o-series / GPT-5 reasoning).
  - **`uploadFile`** (référence portable, pas de ré-upload) → améliore T3 (multimodal).
  - **Timeouts** total/step/chunk/tool + `TimeoutError` propagé dans le stream → remplace le timeout hand-rollé.
- **Contre** : le SDK tourne en JS → **la clé API ne doit jamais transiter par le renderer**. Il faut donc l'exécuter dans un contexte JS de confiance, pas dans le webview (résolu par A3 ci-dessous). À noter : Anthropic n'est pas OpenAI-compatible en wire-format (cf. A3, point dur).
  > L'« incohérence de versions » initialement redoutée est un **faux positif** (cf. §1 Point 7) : `ai@7` et `@ai-sdk/react@4` sont la paire GA officielle. Aucun pré-requis d'alignement.

#### Option A3 (RECOMMANDÉE) — Hybride : orchestration TS via AI SDK, secret-keeping en Rust

> **Garder le keyring Rust comme racine de confiance, déplacer l'orchestration LLM côté AI SDK, sans jamais
> exposer la clé au webview.**

Deux variantes d'implémentation, par ordre de préférence :

1. **Sidecar / runtime JS de confiance** : exécuter l'AI SDK dans un contexte Node de confiance (sidecar Tauri,
   ou un worker isolé) à qui Rust *injecte* la clé au démarrage de requête. Le webview ne voit que des events de stream.
2. **Proxy Rust « OpenAI-compatible » local** : Rust expose un endpoint local (loopback, token éphémère) qui
   reçoit les requêtes *sans clé*, injecte la clé depuis le keyring, et relaie vers le provider. Le frontend
   utilise alors l'AI SDK avec `baseURL` = ce proxy local. **Avantage majeur** : un seul point d'injection de
   clé, le frontend bénéficie de tout l'écosystème AI SDK, et Ollama/LM Studio (Pari B) deviennent triviaux
   (juste un `baseURL` différent, pas de clé). C'est l'approche la plus alignée avec l'archi actuelle
   (Rust = gardien des secrets, TS = orchestration UI).

3. **(RETENU — raffinement de la variante 2) Proxy adossé à l'IPC via `fetch` custom** : plutôt qu'un serveur
   HTTP loopback, on exploite le fait que les providers AI SDK acceptent un **`fetch` custom**. Le renderer
   configure `createOpenAICompatible({ baseURL, fetch: voltFetch })` ; `voltFetch` intercepte la requête
   construite par l'AI SDK (tools, reasoning, multimodal inclus) et la transmet **telle quelle** à une nouvelle
   commande Tauri `ai_proxy_stream(provider, requestBody, channel)` via un `Channel`. Rust injecte la clé depuis
   le keyring, POST vers `${baseURL}/chat/completions` et **re-streame les octets SSE bruts** ; le renderer
   reconstruit une `Response` streamée que l'AI SDK parse nativement.
   - **Pourquoi mieux que le loopback TCP sur Tauri** : aucun port ouvert (surface d'attaque nulle, pas de token
     éphémère), **zéro nouvelle dépendance Rust** (réutilise `reqwest` streaming + `Channel` déjà en place),
     Rust redevient un proxy quasi-transparent → toute l'orchestration (J1/J2/J3) vit côté AI SDK en TS. La clé
     ne traverse jamais la frontière JS. Décision actée le 2026-06-27.

- **Effort** : **L** (refonte) mais **amortie** dès J1/J2/J3 (qui deviennent S/M au lieu de L×4).
- **Reco finale** : **Adopter A3, variante 2 (proxy Rust OpenAI-compatible local).** Migrer le chat builtin vers
  `useChat` + `streamText` (AI SDK) parlant à un proxy loopback Rust qui détient les clés. Garder temporairement
  le path Rust hand-rollé pour les **extensions** (`ext_ai_ask_stream`) afin de ne pas casser l'API publique
  d'extension d'un coup, puis converger. **Pré-requis versions : AUCUN** — l'audit lockfile (2026-06-27)
  confirme que `ai@7.0.2` + `@ai-sdk/react@4.0.2` sont la paire GA cohérente d'AI SDK 7 (cf. §1 Point 7).
  Le seul point dur à trancher au démarrage est le wire-format **Anthropic** (voir ci-dessous).
  Cette décision transforme J1/J2/J3 et le Pari B de « L chacun » en incréments faibles, encore renforcé par
  les primitives AI SDK 7 (`ToolLoopAgent`, tool approvals signées HMAC, `reasoning`, timeouts).

> **Point dur A3 — Anthropic n'est pas OpenAI-compatible.** Le proxy loopback expose une surface
> `/v1/chat/completions` (et `/v1/responses`). OpenAI / Groq / Ollama / LM Studio s'y branchent
> directement. Pour Anthropic, deux options : (a) router vers l'**endpoint OpenAI-compatible d'Anthropic**
> (le plus simple, mais sous-ensemble de features), ou (b) faire **traduire** le proxy Rust (messages,
> tools, thinking) vers `/v1/messages`. Reco : démarrer par (a) pour le chat builtin, garder le path Rust
> Anthropic natif existant (`ext_ai_anthropic_stream`) en fallback, et n'investir dans (b) que si une feature
> Anthropic-spécifique (extended thinking budget) le justifie.

### Pari B — Modèles locaux (Ollama / LM Studio)

- **Impact** : Élevé (confidentialité, gratuité, offline, public dev/power-user — cœur de cible de Volt).
- **Effort** : **M** en hand-roll Rust ; **S** si A3 est adopté.
- **Fichiers** : `AI_KNOWN_PROVIDERS` + un nouveau provider `ollama`/`local` avec `baseURL` configurable (`http://localhost:11434/v1`, `http://localhost:1234/v1`) ; settings AI pour saisir l'URL ; pas de clé requise.
- **Dépendances** : **fortement facilité par le Pari A3** (endpoints OpenAI-compatibles → zéro code provider spécifique).
- **Reco** : livrer **juste après A3**. C'est le meilleur ratio valeur/effort une fois l'orchestration TS en place, et un argument produit fort.

### Pari C — RAG via BaseMyAI (remplace le plan E5/cosine maison)

> **Révisé 2026-06-27** : décision de brancher [`basemyai`](../../forgemyai/basemyai) (moteur de mémoire local,
> écosystème interne) plutôt que de réinventer un pipeline chunking → `embed_batch` → cosine sur le moteur
> fastembed e5-small existant. BaseMyAI couvre nativement ce que le plan original allait construire à la main,
> en mieux : 4 couches de mémoire (short-term/episodic/procedural/semantic), **RAG temporel** (`valid_from`/
> `valid_until`, jamais de fait périmé), knowledge graph + fusion RRF (vecteur + graphe), et forgetting adaptatif
> (GC borné en capacité). C'est un **crate Rust natif** — consommé en process direct par `src-tauri` (zéro FFI,
> zéro sidecar HTTP), contrairement aux SDK Python/Node qui visent des consommateurs non-Rust.
>
> **Bloqué intentionnellement** : `basemyai` est en **v0.1.0**, CI/release pas encore validées de bout en bout
> (cf. son `TODO.md`). On attend sa stabilisation avant d'intégrer — pas de la prudence excessive, juste éviter
> de bâtir sur une fondation qui bouge encore.
>
> **Implication architecture** : adopter `basemyai` remplacerait probablement le moteur fastembed e5-small
> (`embeddings/mod.rs`) plutôt que de coexister avec lui (BaseMyAI embarque ses propres embeddings Candle
> in-process) — à trancher au moment de l'intégration, pas avant.

- **Impact** : Élevé et différenciant (mémoire persistante + temporelle pour l'assistant, pas juste un RAG plat).
- **Effort** : **L** (mais largement amorti vs. le plan E5/cosine maison qui devait construire chunking, store vectoriel, et n'avait aucune notion temporelle/forgetting).
- **Intégration prévue** :
  - Dépendance Cargo native `basemyai` dans `src-tauri` une fois la lib stabilisée.
  - `mem.remember(...)` pour capturer le contexte (notes, fichiers indexés, conversations) dans les couches appropriées.
  - `mem.recall(...)` exposé comme **tool** (`search_knowledge`) une fois J1 livré — laisse le modèle décider quand chercher.
  - Synergie J1/A3 : `consolidate(memory, llm)` de BaseMyAI prend un `LlmInference` injecté — le proxy AI SDK déjà en place (Sprint 2) peut le nourrir directement.
- **Dépendances** : J1 (tool-loop) pour l'exposition propre ; **stabilisation de `basemyai`** (bloquant, externe).
- **Reco** : ne pas démarrer avant que `basemyai` ait une release validée. Revisiter ce point à ce moment-là plutôt que de fixer une date.

---

## 5. Synthèse priorisée (impact × effort)

| # | Item | Niveau | Impact | Effort | Dépend de |
|---|------|--------|--------|--------|-----------|
| T1 | Mémoire multi-tour | 🔴 | Critique | M | — |
| T2 | OpenAI `max_completion_tokens` / Responses API | 🔴 | Élevé | S→M | — |
| T3 | Vision images (ou retrait affordance) | 🔴 | Moyen-élevé | M / S | — |
| T4 | Rate limit chat builtin | 🔴 | Moyen | S | — |
| J1 | Tool / function calling | 🟡 | 🚀 Max | L | T1, (A) |
| J2 | Structured outputs (json_schema) | 🟡 | Moyen-élevé | M | — |
| J3 | Reasoning tokens streaming | 🟡 | Moyen-élevé | M | T2 |
| A | **Orchestration : AI SDK TS + proxy Rust (A3)** | 🔵 | Structurant | L (amorti) | versions `ai` |
| B | Modèles locaux Ollama / LM Studio | 🔵 | Élevé | M / S* | A3 |
| C | RAG via BaseMyAI (bloqué : stabilisation externe) | 🔵 | Élevé | L | J1, release `basemyai` |

\* S si le Pari A3 est adopté.

### Séquençage recommandé

1. **Sprint 1 (correctness)** ✅ : T2 (fix `max_completion_tokens` immédiat), T4, **T1 (multi-tour)**, T3 (vision).
2. **Sprint 2 (pari structurant)** ✅ : **A3** (proxy Rust loopback OpenAI-compatible + AI SDK 7 TS) sur le chat builtin.
3. **Sprint 3 (valeur)** ✅ : **J1 (tools)** + J2 (structured) + J3 (reasoning).
4. **Sprint 4 (différenciation)** : **B (modèles locaux)** ✅ livré. **C (RAG via BaseMyAI)** ⏸️ en attente d'une release stabilisée de `basemyai` (v0.1.0 actuellement, CI/release non validées de bout en bout) — revisiter à ce moment plutôt que fixer une date.

---

## 6. Checklist condensée

```
🔴 Table-stakes (correctness) — Sprint 1 ✅
[x] T1  Envoyer messages[] (historique) dans le payload IPC + reconstruire la conversation côté Rust
[x] T1  Type partagé ChatTurn { role, content } (serde camelCase / TS) + bornage historique (tokens/N tours)
[x] T1  Préserver l'injection AI Profile en tête du system prompt
[x] T2  Remplacer max_tokens → max_completion_tokens (OpenAI)
[x] T2  Ne pas envoyer temperature pour les modèles de raisonnement (o-series / GPT-5 reasoning)
[ ] T2  (cible, repoussé) Migrer OpenAI vers la Responses API (/v1/responses) + nouveau parsing SSE
[x] T3  Brancher message.files → content parts multimodal (vision implémentée, pas retirée)
[x] T3  content: string → content: Part[] dans useAiChat + builders providers
[x] T4  Appliquer ai_check_rate_limit au chat builtin (ai_ask_builtin_stream)

🟡 Features haute-valeur — Sprint 3 ✅
[x] J1  Tool-loop multi-tours (modèle → tool_call → exécution Tauri → ré-injection → modèle) — stepCountIs(6) côté AI SDK
[x] J1  Exposer en tools : recherche fichiers/apps, presse-papier, métriques, quicklinks (lib/aiTools.ts, 8 tools)
[x] J1  UI tool calls (AI Elements Tool/ToolInput/ToolOutput) + confirmation pour actions à effet de bord (lib/aiToolApproval.ts)
[x] J2  Structured outputs via generateVoltObject (lib/aiStructured.ts, json_schema via proxy streaming)
[x] J3  Reasoning streamé : middleware d'extraction <think> (lib/aiTransport.ts) + rendu Reasoning/ReasoningContent
[x] J3  Affichage repliable via AI Elements Reasoning/ReasoningContent

🔵 Paris stratégiques — A + B ✅, C repointé vers BaseMyAI (bloqué)
[x] A   Audit versions ai (7.0.2) vs @ai-sdk/react (4.0.2) → paire GA cohérente, aucun alignement requis
[x] A   Routage Anthropic tranché : endpoint compat OpenAI (option a) pour le chat builtin
[x] A   Proxy Rust OpenAI-compatible local (ai_proxy_stream, injection clé depuis keyring, relai SSE transparent)
[x] A   Chat builtin migré vers useChat + streamText (AI SDK 7) pointant sur le proxy (lib/aiTransport.ts)
[x] A   Path Rust conservé pour les extensions (ext_ai_ask_stream) — convergence non encore faite
[x] B   Provider local (baseURL configurable Ollama/LM Studio, sans clé) — Sprint 4, frontend pur (le proxy A3 acceptait déjà base_url + keyless). lib/localProvider.ts + section Settings + dropdown chat + baseUrl threadé transport→proxy.
[ ] C   ⏸️ Bloqué : attendre une release stabilisée de `basemyai` (v0.1.0, CI/release non validées) avant d'intégrer
[ ] C   Dépendance Cargo native `basemyai` dans src-tauri (zéro FFI/sidecar — crate Rust natif)
[ ] C   mem.recall(...) exposé comme tool (search_knowledge) une fois branché
[ ] C   Décider : remplacer fastembed e5-small par les embeddings Candle de BaseMyAI, ou coexister

🔒 Invariants à NE PAS casser
[x] Clés API restent dans le keyring OS, jamais dans le renderer (proxy Rust = seul point d'injection)
[x] Streaming préservé (relai SSE transparent, pas de parsing côté Rust)
[ ] Limite de taille de prompt repensée par-conversation (et non par-message) — à revérifier à l'implémentation

⚠️ Nettoyage restant (hors checklist initiale)
[ ] Retirer le path mort ai_ask_builtin_stream (remplacé par ai_proxy_stream)
[ ] Ajouter ai_proxy_cancel pour que Stop annule aussi côté provider (pas seulement côté UI)
[ ] Converger ext_ai_ask_stream (extensions) vers le même proxy A3 que le chat builtin
[ ] Tout le travail Sprints 1-4 est local, non commité — checkpoint à faire
```

---

*Roadmap rédigée le 2026-06-27. Toutes les références `fichier:ligne` reflètent l'état du repo à cette date
et sont à revalider avant implémentation si le code a évolué.*
