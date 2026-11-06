// Galeria "Quem já sentou à mesa" do media kit: a equipe escolhe, entre os episódios já gravados (publicados ou ainda em produção),
// quem aparece. Todo episódio do sistema já foi gravado: ele nasce na etapa "Gravado".
// Foto, nome e Instagram vêm do convidado; alcance e frase de apresentação podem ser ajustados por episódio.
const db = require('../db/pool');
const guestPhotos = require('./guestPhotos');

const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max) || null;

// Todos os episódios (ordem do primeiro ao mais recente), com a etapa e o que a tela de seleção precisa.
async function candidates() {
  const { rows } = await db.query(
    `SELECT e.id, e.number, e.title, e.status, e.kit_featured, e.kit_audience, e.kit_credential,
            g.id AS guest_id, g.name AS guest_name, g.instagram, g.job_title, g.company, g.bio, (g.photo_key IS NOT NULL) AS has_photo
       FROM episodes e LEFT JOIN guests g ON g.id = e.guest_id
      ORDER BY e.number NULLS LAST, e.id`);
  return rows;
}

// Frase de apresentação: a escrita para o kit; senão, o cargo/empresa do convidado; senão, o início da bio.
function credentialOf(r) {
  if (r.kit_credential) return r.kit_credential;
  const role = [r.job_title, r.company].filter(Boolean).join(' · ');
  if (role) return role;
  return r.bio ? String(r.bio).replace(/\s+/g, ' ').slice(0, 140) : '';
}

async function save(id, { audience, credential }) {
  const { rowCount } = await db.query(
    `UPDATE episodes SET kit_audience = $2, kit_credential = $3, updated_at = now() WHERE id = $1`,
    [id, clean(audience, 20), clean(credential, 200)]);
  return rowCount > 0;
}

async function setFeatured(id, on) {
  const { rowCount } = await db.query(`UPDATE episodes SET kit_featured = $2, updated_at = now() WHERE id = $1`, [id, Boolean(on)]);
  return rowCount > 0;
}

// Itens da galeria do kit. Lista vazia = ninguém escolhido ainda (o kit mostra a galeria padrão de lançamento).
async function items() {
  const rows = (await candidates()).filter((r) => r.kit_featured && r.guest_id);
  return rows.map((r) => ({
    name: r.guest_name,
    photo: r.has_photo ? guestPhotos.signedUrl(r.guest_id) : null,
    audience: r.kit_audience || '—',
    credential: credentialOf(r),
    handle: r.instagram ? String(r.instagram).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '') : null,
    ep: r.number,
  }));
}

// Rodapé do slide: quantos episódios já estão no ar e quantos já foram gravados e vêm a seguir (vem do sistema, não fica velho).
async function footText() {
  const { rows: [r] } = await db.query("SELECT count(*) FILTER (WHERE status = 'publicado')::int AS no_ar, count(*) FILTER (WHERE status <> 'publicado')::int AS a_caminho FROM episodes");
  const parts = [];
  if (r.no_ar) parts.push(`${r.no_ar} ${r.no_ar === 1 ? 'episódio' : 'episódios'} no ar`);
  if (r.a_caminho) parts.push(`${r.a_caminho} ${r.a_caminho === 1 ? 'gravado' : 'gravados'} a caminho`);
  parts.push('1 novo por semana');
  return parts.join(' · ');
}

module.exports = { candidates, credentialOf, save, setFeatured, items, footText, clean };
