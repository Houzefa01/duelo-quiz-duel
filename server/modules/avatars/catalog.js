// Catalogue des 44 avatars cartoon téléchargés (voir docs/LICENCES.md).
export const AVATARS = [
  ...['a1','a2','a3','a4','a5','a6','a7','a8','a9','a10','a11','a12','a13','a14'].map((n) => ({ f: `personnage-${n}.svg`, cat: 'personnages' })),
  ...['p1','p2','p3','p4','p5','p6'].map((n) => ({ f: `personnage-${n}.svg`, cat: 'personnages' })),
  ...['n1','n2','n3','n4','n5','n6','n7','n8'].map((n) => ({ f: `clas-${n}.svg`, cat: 'personnages' })),
  ...['o1','o2','o3','o4','o5','o6','o7','o8'].map((n) => ({ f: `fanta-${n}.svg`, cat: 'fantaisie' })),
  ...['l1','l2','l3','l4'].map((n) => ({ f: `fanta-${n}.svg`, cat: 'fantaisie' })),
  ...['e1','e2','e3','e4'].map((n) => ({ f: `creat-${n}.svg`, cat: 'creatures' })),
  ...['chat','chien','renard','panda','grenouille','abeille','poisson','lion','tigre','lapin','koala','hibou'].map((n) => ({ f: `anim-${n}.svg`, cat: 'animaux' })),
];
export const DEFAUT_AVATAR = 'personnage-a1.svg';
export const isPreset = (f) => AVATARS.some((a) => a.f === f);
export const randomAvatar = () => AVATARS[Math.floor(Math.random() * AVATARS.length)].f;

// URL publique d'avatar pour un utilisateur (utilisée par profils, classements, duel).
export function avatarUrlFor(u) {
  if (!u) return `/assets/avatars/${DEFAUT_AVATAR}`;
  if (u.avatar_kind === 'upload' && u.avatar_ref) return `/api/v1/avatar/photo/${u.avatar_ref}`;
  return `/assets/avatars/${isPreset(u.avatar_ref) ? u.avatar_ref : DEFAUT_AVATAR}`;
}
