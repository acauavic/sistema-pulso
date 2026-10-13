#!/usr/bin/env bash
# Instala o Pulso Gestão numa VPS Ubuntu/Debian "zerada". Rode NO SERVIDOR, como root:
#   apt-get update && apt-get install -y git && git clone -b claude/hopeful-volta-vt44fa https://github.com/acauavic/sistema-pulso.git /opt/pulso && bash /opt/pulso/deploy/instalar.sh
# (depois que a branch for para o main, troque o nome da branch acima por main)
# Pergunta o domínio e o seu e-mail de superadmin, gera os segredos sozinho e sobe tudo com HTTPS.
set -euo pipefail

REPO="${REPO:-https://github.com/acauavic/sistema-pulso.git}"
BRANCH="${BRANCH:-claude/hopeful-volta-vt44fa}"
DIR="${DIR:-/opt/pulso}"

[ "$(id -u)" -eq 0 ] || { echo "Rode como root."; exit 1; }

command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null; }

# VPS pequena: o build do Node precisa de memória. Sem swap e com menos de 3 GB, cria 2 GB de swap.
if [ "$(swapon --show | wc -l)" -eq 0 ] && [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)" -lt 3000 ]; then
  echo ">> Criando 2 GB de swap…"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null 2>&1; then
  echo ">> Instalando Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if [ -d "$DIR/.git" ]; then
  echo ">> Atualizando o código em $DIR…"
  git -C "$DIR" fetch --all -q && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" pull -q --ff-only
else
  echo ">> Baixando o código…"
  apt-get update -qq && apt-get install -y -qq git >/dev/null
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/deploy"

if [ ! -f .env ]; then
  IP="$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  PADRAO="$(echo "$IP" | tr . -).sslip.io"
  echo "Domínio do painel. Se já tem um (ex.: gestao.seudominio.com), o DNS dele precisa apontar para $IP."
  read -rp "Sem domínio ainda? Só aperte Enter para usar $PADRAO (funciona com HTTPS na hora): " DOMINIO
  DOMINIO="${DOMINIO:-$PADRAO}"
  read -rp "E-mail do primeiro superadmin: " ADMIN_EMAIL
  read -rp "Nome do superadmin: " ADMIN_NOME
  gen() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  umask 077
  cat > .env <<ENV
DOMINIO=$DOMINIO
APP_BASE_URL=https://$DOMINIO
PODCAST_NAME=Podcast Pulso
POSTGRES_PASSWORD=$(gen 32)
SESSION_SECRET=$(gen 64)
# Integrações (preencha quando tiver; sem elas o painel abre, mas e-mails/IA/arquivos ficam desligados):
MAIL_DRY_RUN=true
BREVO_SERVER=smtp-relay.brevo.com
BREVO_PORT=587
BREVO_USER=
BREVO_CHAVE_SMTP=
BREVO_EMAIL=
BREVO_FROM_NAME=Podcast Pulso
YOURLS_LINK=
YOURLS_KEY=
BB_KEY_ID=
BB_APPLICATION_KEY=
BUCKET_NAME=
BB_ENDPOINT=
GEMINI_KEY=
GROQ_APIKEY=
UPLOAD_POST_KEY=
UPLOAD_POST_USER=
UPLOAD_POST_LIVE=false
PATROCINIO_WHATSAPP=
PRODUCAO_WHATSAPP=
ENV
  echo "$ADMIN_EMAIL|$ADMIN_NOME" > .primeiro-admin
fi

echo ">> Construindo e subindo (a primeira vez demora alguns minutos)…"
docker compose up -d --build

echo ">> Aguardando o painel…"
for _ in $(seq 1 40); do
  docker compose exec -T web node -e "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break
  sleep 3
done

# Chaves do Web Push (alertas com o painel fechado): geradas uma vez e guardadas no .env.
if ! grep -q '^VAPID_PUBLIC_KEY=.\+' .env; then
  echo ">> Gerando as chaves dos alertas (Web Push)…"
  sed -i '/^VAPID_/d' .env
  docker compose exec -T web node -e "const k=require('web-push').generateVAPIDKeys();console.log('VAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey+'\nVAPID_SUBJECT=mailto:contato@podcastpulso.com')" >> .env
  docker compose up -d >/dev/null
fi

if [ -f .primeiro-admin ]; then
  IFS='|' read -r EMAIL NOME < .primeiro-admin
  echo ">> Criando o superadmin ($EMAIL). Um link para definir a senha é gerado (ou enviado por e-mail, se o SMTP estiver configurado)."
  docker compose exec -T web node src/scripts/createSuperadmin.js "$EMAIL" "$NOME" || true
  rm -f .primeiro-admin
fi

# Backup diário do banco (03:30), guardando os últimos 14 dias em /opt/pulso-backups.
mkdir -p /opt/pulso-backups && chmod 700 /opt/pulso-backups
cat > /etc/cron.d/pulso-backup <<CRON
30 3 * * * root cd $DIR/deploy && docker compose exec -T postgres pg_dump -U pulso -d pulso | gzip > /opt/pulso-backups/pulso-\$(date +\%F).sql.gz && find /opt/pulso-backups -name 'pulso-*.sql.gz' -mtime +14 -delete
CRON

echo
echo "Pronto. Painel: https://$(grep '^DOMINIO=' .env | cut -d= -f2)"
echo "Segredos e integrações: $DIR/deploy/.env (depois de editar, rode: cd $DIR/deploy && docker compose up -d)"
echo "Backup diário do banco: /opt/pulso-backups (14 dias)."
echo "Atualizar para uma versão nova: cd $DIR && git pull && cd deploy && docker compose up -d --build"
