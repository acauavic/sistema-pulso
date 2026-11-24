# Calendário de posts do portal com os agendados

## Por quê

O calendário de posts do portal do convidado é digitado à mão e não conversa com o agendamento do Social. A equipe agenda
os posts e depois teria de repetir tudo no calendário. O pedido: o que está agendado aparece sozinho no portal, com o dia,
a hora e a capa, sem o vídeo, e o Reel de teste fica de fora.

## Decidido com o dono

- **Quais posts**: os do episódio do convidado e os que marcam o @ dele como collab (a mesma regra de "Posts em collab com você").
- **Reel de teste não aparece**: a publicação com Reel de teste some do calendário inteira (inclusive a parte do TikTok e do YouTube).
- **Saiu, sai do calendário**: quando o post vai ao ar, ele sai do calendário e aparece na lista de posts, com o link.
- **Sozinho**: aparece em todo portal ligado, sem a equipe ligar nada.
- **Collab só no Instagram**: o item diz em que redes o post sai; o chip de collab diz Instagram. Uma frase no calendário avisa
  que a collab é só no Instagram e que, para ter collab em outra rede, a pessoa fala com a produção (link "Falar com a produção").
- **O calendário à mão continua**: as linhas digitadas pela equipe entram na mesma lista, em ordem de data e hora.

## Abordagens

1. **Os dois juntos (escolhida)**: agendados automáticos + linhas à mão numa lista só. Cobre a semana antes de tudo estar agendado.
2. Só o automático: mais simples, mas a semana só aparece depois de tudo agendado e some o que já funciona para a Carol Borba.
3. O automático no lugar do manual: a lista à mão só quando não há agendado; confunde quando metade está agendada.

## Como fica

- **Serviço** (`services/guestPortal.js`): `scheduledPosts(g)` busca as publicações `agendado` e `enviando` com a regra acima,
  sem Reel de teste (`igPeople.trialOf(options.instagram)` com Instagram nas redes), e devolve dia, hora, título, redes, capa e se é
  collab no Instagram. `content(g)` junta esses itens com o plano à mão (`planOn` continua mandando só nas linhas à mão) numa lista
  ordenada por data e hora; o calendário aparece quando a lista tem algo.
- **Portal** (`views/portal/guest.ejs`): cada item agendado mostra a capa pequena (9:16, só imagem), o título, "às 18h30" em mono,
  as redes em mono e o chip plum "collab · Instagram" quando o @ dele está marcado. Linha à mão continua "Por volta de 18h". Embaixo:
  "Datas e horários podem mudar. A collab é só no Instagram; se quiser collab em outra rede, fale com a produção."
- **Capa**: a rota `/convidado/:token/capa/:cid` passa a aceitar a capa dos agendados que estão no calendário (e nada além).
- **Painel** (aba Portal do convidado, cartão "Calendário de posts"): os agendados aparecem na lista, com "AGENDADO" em mono e sem
  editar (vêm do Social), para a equipe ver o que o convidado vê. Editar continua só nas linhas à mão.

## Calls meus (pode corrigir)

- Esperando aprovação (`revisao`) não entra: o horário ainda pode não valer. Falhou (`erro`) também não.
- Agendado cuja hora passou e ainda não saiu continua no calendário até sair.
- Se a equipe digitou à mão um post que depois foi agendado, aparecem os dois: tirar a linha à mão é com a equipe.
- Versão 2.9.0 (funcionalidade), junto com a 2.8.1 que ainda não foi publicada.
