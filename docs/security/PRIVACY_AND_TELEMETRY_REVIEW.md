# Revue confidentialité et télémétrie

_État du dépôt examiné : 2026-06-13. Ce document fixe la cible produit et relève les écarts à valider avant marketing public._

## Principe

Volt doit fonctionner comme un outil local sans télémétrie comportementale par défaut. « Private » doit être expliqué par des comportements vérifiables, pas utilisé comme synonyme de « aucune connexion réseau ».

## Ce que Volt ne doit jamais collecter par défaut

- Requêtes tapées dans le launcher.
- Contenu ou historique du presse-papiers.
- Contenu des fichiers, notes, snippets ou résultats de recherche.
- Chemins complets, noms de fichiers ou liste d'applications installées.
- Commandes shell, répertoires de travail ou output.
- Tokens, clés API, cookies, credentials et données du keyring.
- Prompts/réponses IA ou contenu envoyé à une intégration.
- Historique de lancement, frecency ou raccourcis personnels.
- Identifiant publicitaire, fingerprint matériel ou identifiant persistant inter-installation.
- Crash dumps, logs ou diagnostics envoyés automatiquement.

Cette interdiction concerne la transmission hors appareil. Certaines données sont aujourd'hui conservées localement pour fournir les fonctions demandées.

## Données pouvant rester locales

| Donnée | Finalité | Règle cible |
|---|---|---|
| Settings et onboarding | Configuration utilisateur | Local, export explicite, suppression documentée. |
| Index fichiers et historique d'accès | Recherche locale/frecency | Local; exclusions; reset; chemins non inclus dans diagnostics par défaut. |
| Clipboard | Historique recherché | Consentement clair, pause, rétention, exclusions, suppression rapide. |
| Snippets et quicklinks | Productivité | Local; import/export explicite. |
| Shell history | Suggestions | Local; redaction; désactivation/clear; aucune transmission. |
| Notes | Prise de notes | Local sauf sync explicitement activée. |
| Logs | Diagnostic | Local, redacted, rétention limitée, partage manuel. |
| Extensions, préférences et storage | Fonctionnement extension | Isolé par extension; permissions et suppression à l'uninstall. |

## Ce qui exige un opt-in explicite

- Authentification et cloud sync.
- Fournisseurs IA et envoi de prompts/contenus.
- Intégrations GitHub, Notion ou autres services.
- Installation d'une extension demandant réseau, clipboard, notifications ou accès système.
- Envoi d'un crash report, log ou bundle diagnostic.
- Toute future analytics produit, même pseudonyme ou « privacy-friendly ».
- Téléchargement d'un modèle lourd non nécessaire au flux principal.

L'auto-update peut être activé par défaut s'il est expliqué, désactivable et limité à la vérification de version; il ne doit pas être présenté comme télémétrie.

## Inventaire actuel à vérifier

| Zone | Observation du dépôt | Risque / action |
|---|---|---|
| Analytics | Aucun SDK analytics généraliste identifié dans `package.json`. | Vérifier trafic runtime et services externes avant chaque release. |
| Update | Check automatique activé par défaut; endpoint GitHub Releases. | Documenter IP/User-Agent éventuels et option de désactivation. |
| Extension registry | Sources GitHub/Supabase et compteurs de téléchargement possibles. | Décrire les requêtes et éviter un identifiant utilisateur persistant. |
| Auth/sync | Supabase et API Volt utilisées après action utilisateur. | Opt-in, politique serveur, rétention et suppression de compte requises. |
| IA | OpenAI/Anthropic/Groq/Replicate/Hugging Face/Pollinations apparaissent selon features. | Afficher fournisseur, contenu envoyé et coût avant le premier envoi. |
| Clipboard | Monitoring activé par défaut, rétention 30 jours, filtre sensible heuristique. | Disclosure onboarding; revoir default/consentement; tests password managers. |
| Bases locales | SQLCipher existe, mais le build par défaut utilise SQLite bundlé non chiffré. | Ne pas promettre « encrypted local data »; décider la cible v1. |
| Logs frontend | `logger.ts` sérialise des arguments et tente `log_from_frontend`; contrat backend non identifié. | Réparer ou supprimer; ajouter redaction et tests. |

## Crash reports

- Aucun envoi automatique.
- Dialogue opt-in par incident, décoché par défaut.
- Prévisualisation et édition du rapport avant envoi.
- Exclure clipboard, queries, contenu, commandes, tokens et chemins complets.
- Générer un identifiant aléatoire par rapport, pas un identifiant permanent.
- Afficher destination, politique de rétention et moyen de suppression.
- Les minidumps/core dumps nécessitent un consentement renforcé car ils peuvent contenir des secrets mémoire.

## Redaction des logs

### À redacter

- Tokens GitHub/AWS/Stripe/Slack/JWT, clés API et mots de passe.
- Query params OAuth/deep links et credentials dans URL.
- Headers `Authorization`, `Cookie`, `Set-Cookie`.
- Commandes shell et arguments contenant secrets.
- Contenu clipboard, snippets, notes et prompts.
- Chemins utilisateur complets lorsqu'un basename ou placeholder suffit.

### Règles

- Redaction avant écriture disque, pas seulement à l'export.
- Tests avec corpus positif/négatif pour éviter fuites et sur-redaction.
- Niveau `info` sans contenu utilisateur; détails sensibles uniquement en debug opt-in et toujours redacted.
- Rétention explicite; supprimer les logs anciens automatiquement.
- Export diagnostics prévisualisable avec avertissement.

## Sécurité clipboard

- Le clipboard est une source de secrets; le filtre actuel est heuristique et ne garantit rien.
- Le monitoring par défaut doit être précédé d'une explication visible ou reconsidéré.
- Fournir pause immédiate, clear, rétention et exclusions d'applications.
- Prévoir une liste de gestionnaires de mots de passe courants, modifiable par l'utilisateur.
- Ne pas indexer/copier un contenu rejeté dans les logs.
- Évaluer chiffrement local, verrouillage OS et comportement multi-utilisateur.

## Sécurité shell history

- Désactivation claire du shell et de son historique.
- Redaction avant persistence et logs, avec tests de nouveaux formats de secret.
- Ne pas stocker l'output par défaut si non nécessaire.
- Afficher que la blocklist réduit les accidents mais ne rend pas une commande sûre.
- Clear history doit supprimer les données persistées et les suggestions en mémoire.

## Sécurité des chemins fichier

- Les chemins restent locaux sauf action explicite d'export/sync/intégration.
- Diagnostics et crash reports utilisent placeholders (`<HOME>`, `<APP_DATA>`).
- Préviews refusent fichiers sensibles et zones système selon une blocklist documentée.
- Les extensions ne reçoivent pas de chemins arbitraires sans permission et action utilisateur.
- L'uninstall/reset doit expliquer si index, historique et notes restent sur disque.

## Confidentialité des permissions extensions

- Permission demandée au premier usage, avec finalité et exemples de données accessibles.
- Refus par défaut; possibilité de révocation dans Settings.
- Les permissions inconnues sont rejetées côté backend.
- Réseau : afficher domaines si le manifest peut les déclarer; proxy sans cookies/auth implicites.
- Clipboard : distinguer lecture, écriture et paste si le modèle évolue.
- Storage/secrets : isolation par extension et suppression lors de l'uninstall selon choix utilisateur.
- Une extension « verified » doit signifier un processus de revue documenté, pas une garantie absolue.

## Copie utilisateur proposée

### Version courte

> Volt fonctionne localement par défaut. Vos recherches, fichiers, historique du presse-papiers, snippets et commandes ne sont pas envoyés à Volt. Certaines fonctions facultatives, comme les mises à jour, extensions réseau, intégrations, IA ou synchronisation, contactent un service externe et l'indiquent avant usage.

### Clipboard

> L'historique du presse-papiers est enregistré sur cet appareil pour être recherché dans Volt. Il peut contenir des informations sensibles. Vous pouvez mettre le monitoring en pause, exclure des applications, modifier la rétention ou effacer l'historique à tout moment.

### Extensions

> Les extensions s'exécutent avec des permissions explicites. Vérifiez les accès demandés avant installation. L'isolation réduit les risques, mais une extension tierce ne doit être installée que si vous faites confiance à sa source.

### Diagnostics

> Les logs restent sur votre appareil. Volt n'envoie pas automatiquement de crash report. Vérifiez toujours le contenu d'un diagnostic avant de le partager.

## Critères avant claim « private »

- [ ] Audit réseau d'une fresh install et de chaque fonction opt-in.
- [ ] Politique de confidentialité publiée et liée depuis l'application.
- [ ] Consentement clipboard et rétention validés.
- [ ] Contrat crash reports/logs défini et testé.
- [ ] Chiffrement local ou disclosure explicite du stockage non chiffré.
- [ ] Suppression/uninstall et données serveur documentés.
- [ ] Claims du README alignés avec ces limites.

Tant que ces critères ne sont pas fermés, utiliser une formulation précise : **« No usage telemetry by default; core search data stays on your device. Optional online features connect only when enabled or used. »**
