# API Duelo (`/api/v1`)

Auth : `POST /auth/register {username,password,email?,ageOk}` · `/auth/login` ·
`/auth/logout` · `/auth/logout-all` · `/auth/recover {username,code,newPassword}` ·
`/auth/guest`.
Moi : `GET /me` · `PATCH /me {avatar,frame,title}` · `GET /me/export` · `DELETE /me` ·
`GET /history` · `GET /users/:username`.
Amis : `POST /friends/request|accept|block {username}` · `GET /friends`.
Classement public : `GET /leaderboard?scope=global|weekly|category|friends&page=`.
Récompenses : `POST /chest/claim` · `GET /shop` · `POST /shop/buy {slug}`.
Défis : `GET /challenges` · `POST /challenges/:id/claim` · `GET /daily-run` ·
`POST /daily-run/start|answer` · `POST /friend-challenges {username,stake}` ·
`POST /friend-challenges/:id/accept`.
Tournois : `GET /tournaments` · `GET /tournaments/:id` · `POST /tournaments/:id/join|checkin` ·
`POST /tournaments` (admin) · `POST /tournaments/matches/:id/win` (admin).
Questions : `POST /questions` · `POST /questions/:id/vote {vote}` ·
`POST /questions/:id/report {reason}` · `GET /questions/pending`.
Admin : `GET /admin/metrics|moderation|audit` · `POST /admin/questions/:id {action}` ·
`POST /admin/sanction {username,action}`.
Système : `GET /healthz` · `GET /api/v1/meta`.

## Phase 12 — avatars, thème, organisateurs, lots
Avatars : `GET /avatars` (catalogue) · `PATCH /me/avatar {ref}` · `POST /me/avatar/upload`
(multipart `photo`, 3 Mo) · `DELETE /me/avatar/upload` · `GET /avatar/photo/:uuid[?s=64]` ·
`POST /avatars/:username/report` · `PATCH /me/theme {theme: system|light|dark}`.
Organisateurs : `GET /organizer/tournaments` · `POST /organizer/tournaments` (brouillon, 5/j) ·
`PATCH /organizer/tournaments/:id` · `POST /organizer/tournaments/:id/publish|cancel|duplicate|release` ·
`GET /organizer/tournaments/:id/export.csv` · `POST /organizer/tournaments/:id/disqualify {userId}` ·
`GET /organizer/tournaments/:id/rewards` · `POST /organizer/tournaments/:id/rewards` (lot) ·
`POST /organizer/rewards/upload` (fichier, 20 Mo) · `POST /organizer/rewards/:id/replace`.
Mes lots : `GET /me/rewards` (métadonnées, jamais de contenu) · `POST /me/rewards/:claimId/reveal`
(`Cache-Control: no-store`) · `GET /me/rewards/:claimId/download` (5 max, attachment) ·
`POST /me/rewards/:claimId/report {reason}`.
Tournois : `GET /tournaments?kind=official|organizer` · `GET /tournaments/by-code/:code` ·
`POST /tournaments/:id/join` (accepte `{code}` pour privé) · fiche avec `rewards[]` (libellés publics).
Admin : `POST /admin/organizers/:userId/grant|revoke` · `PATCH /admin/organizers/:userId/quotas` ·
`GET /admin/organizers` · `GET /admin/tournaments/pending` ·
`POST /admin/tournaments/:id/approve|reject {reason}` · `POST /admin/avatars/:userId/remove {banUpload?}` ·
`GET /admin/avatars/reports`.
Toutes les erreurs : `{error: texte FR actionnable}`. 403 si non organisateur/admin.

Erreurs : `{error: code_explicite}` + texte FR actionnable. Codes HTTP standards
(400/401/403/404/409/410/429).
