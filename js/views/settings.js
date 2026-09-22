(function () {
  'use strict';
  var K = window.K, ui = K.ui, h = ui.h, L = K.logic, store = K.store;
  K.views = K.views || {};

  function download(name, text) {
    var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  K.views.parametres = {
    title: 'Paramètres',
    render: function (root) {
      function refresh() {
        var st = store.state, s = st.settings;
        if (root.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; // ne pas couper une saisie en cours
        ui.clear(root);

        function text(key, label, type, hint) {
          return ui.field(label, h('input', { type: type || 'text', value: s[key] == null ? '' : String(s[key]), min: type === 'number' ? '0' : null,
            onchange: function (e) { store.setSetting(key, type === 'number' ? Math.max(0, parseInt(e.target.value, 10) || 0) : e.target.value.trim()); } }), hint);
        }
        root.appendChild(h('section', { class: 'panel' }, h('h2', {}, 'La partie'), h('div', { class: 'stack' },
          text('game_name', 'Nom de la partie'),
          h('div', { class: 'grid-2' }, text('official_players', 'Joueurs inscrits (officiel)', 'number'), text('school_total', 'Élèves à l\'INSA', 'number')))));

        /* Boucles */
        var rounds = L.sortedRounds(st), rs = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Boucles et rerolls'), h('button', { type: 'button', class: 'btn', onclick: K.actions.newRound }, rounds.length ? 'Nouveau reroll' : 'Démarrer la boucle')));
        rounds.forEach(function (r, i) {
          var n = st.links.filter(function (l) { return l.round_id === r.id; }).length;
          rs.appendChild(h('div', { class: 'row' }, h('input', { type: 'text', value: r.name, 'aria-label': 'Nom de la boucle', onchange: function (e) { store.update('rounds', r.id, { name: e.target.value.trim() || r.name }); } }),
            h('span', { class: 'muted small' }, n + ' liens'),
            i === rounds.length - 1 ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
              ui.confirm({ title: 'Supprimer « ' + r.name + ' » ?', text: 'Ses ' + n + ' liens sont effacés. Les kills sont conservés.', action: 'Supprimer', danger: true }).then(function (ok) { if (ok) store.remove('rounds', r.id); });
            } }, 'Supprimer') : null));
        });
        if (!rounds.length) rs.appendChild(h('p', { class: 'empty' }, 'La première boucle se crée toute seule au premier lien saisi.'));
        root.appendChild(rs);

        /* Années, départements, liens */
        var ys = h('section', { class: 'panel' }, h('h2', {}, 'Années et couleurs'));
        (s.years || []).forEach(function (y, i) {
          ys.appendChild(h('div', { class: 'row' },
            h('input', { type: 'text', value: y.name, 'aria-label': 'Année', onchange: function (e) { var a = s.years.slice(); a[i] = { name: e.target.value.trim(), color: y.color }; store.setSetting('years', a); } }),
            h('input', { type: 'color', value: y.color, 'aria-label': 'Couleur de ' + y.name, onchange: function (e) { var a = s.years.slice(); a[i] = { name: y.name, color: e.target.value }; store.setSetting('years', a); } }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retirer ' + y.name, onclick: function () { store.setSetting('years', s.years.filter(function (_, j) { return j !== i; })); } }, '✕')));
        });
        ys.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { store.setSetting('years', (s.years || []).concat([{ name: 'Nouvelle', color: '#8A93A0' }])); } }, 'Ajouter une année'));
        ys.appendChild(ui.field('Départements', h('input', { type: 'text', value: (s.depts || []).join(', '), onchange: function (e) { store.setSetting('depts', e.target.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean)); } }), 'Séparés par des virgules'));
        root.appendChild(ys);

        var ls = h('section', { class: 'panel' }, h('h2', {}, 'Liens utiles'));
        (s.links || []).forEach(function (l, i) {
          function save(patch) { var a = s.links.slice(); a[i] = Object.assign({}, l, patch); store.setSetting('links', a); }
          ls.appendChild(h('div', { class: 'row row-wrap' },
            h('input', { type: 'text', value: l.label, placeholder: 'Nom', 'aria-label': 'Nom du lien', onchange: function (e) { save({ label: e.target.value.trim() }); } }),
            h('input', { type: 'url', value: l.url, placeholder: 'https://…', 'aria-label': 'Adresse du lien', onchange: function (e) { save({ url: e.target.value.trim() }); } }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retirer le lien', onclick: function () { store.setSetting('links', s.links.filter(function (_, j) { return j !== i; })); } }, '✕')));
        });
        ls.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { store.setSetting('links', (s.links || []).concat([{ label: '', url: '' }])); } }, 'Ajouter un lien'));
        root.appendChild(ls);

        /* Accès */
        var acc = h('section', { class: 'panel' }, h('h2', {}, 'L\'équipe'));
        var me = String((store.user && store.user.email) || '').toLowerCase();
        var currentMember = store.member(me);
        if (currentMember) {
          var profileFile = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: function () {
            if (profileFile.files[0]) store.setMemberPhoto(me, profileFile.files[0]);
          } });
          var profilePreview = h('button', { type: 'button', class: 'profile-photo profile-photo-member', 'aria-label': 'Changer ma photo de profil', onclick: function () { profileFile.click(); } },
            currentMember.photo_path ? h('img', { src: store.memberPhotoUrl(currentMember) || '', alt: '' }) : h('span', { class: 'whoami-badge' }, ui.initials(store.displayName(me))));
          var profileActions = h('div', { class: 'toolbar' },
            h('button', { type: 'button', class: 'btn', onclick: function () { profileFile.click(); } }, currentMember.photo_path ? 'Changer la photo' : 'Ajouter une photo'),
            currentMember.photo_path ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () { store.removeMemberPhoto(me); } }, 'Retirer') : null);
          acc.appendChild(h('div', { class: 'profile-row' }, profilePreview,
            h('div', { class: 'profile-meta' }, h('strong', {}, 'Ma photo de profil'), h('span', { class: 'muted small' }, 'Visible par les membres de l\'alliance.'), profileActions), profileFile));
        }
        acc.appendChild(h('p', { class: 'prose muted small' }, store.mode === 'supabase'
          ? 'Seules ces adresses peuvent entrer, et chacune a tous les droits. Le nom est celui qui signe les infos du journal.'
          : 'Mode démo : les données restent dans ce navigateur. Une fois Supabase branché, seules les adresses listées ici pourront entrer.'));
        st.members.forEach(function (m) {
          acc.appendChild(h('div', { class: 'row row-wrap member' },
            h('input', { type: 'text', value: m.name || '', placeholder: m.email.split('@')[0], 'aria-label': 'Nom affiché de ' + m.email, maxlength: '40',
              onchange: function (e) { store.renameMember(m.email, e.target.value.trim()); ui.toast('Nom enregistré.'); } }),
            h('span', { class: 'row-main muted small' }, m.email + (m.email === me ? ' (toi)' : '')),
            store.mode === 'supabase' && m.email !== me ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
              ui.confirm({ title: 'Retirer l\'accès ?', text: m.email + ' ne pourra plus rien lire ni modifier.', action: 'Retirer', danger: true }).then(function (ok) { if (ok) store.removeMember(m.email); });
            } }, 'Retirer') : null));
        });
        if (store.mode === 'supabase') {
          var mail = h('input', { type: 'email', placeholder: 'prenom.nom@insa-cvl.fr', 'aria-label': 'E-mail à autoriser' }), who = h('input', { type: 'text', placeholder: 'Son nom', 'aria-label': 'Nom affiché', maxlength: '40' });
          acc.appendChild(h('div', { class: 'row row-wrap' }, who, mail, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            var email = mail.value.trim().toLowerCase();
            if (!/^\S+@\S+\.\S+$/.test(email)) return ui.toast('Adresse e-mail invalide.', 'error');
            if (st.members.some(function (x) { return x.email === email; })) return ui.toast('Cette adresse a déjà accès.', 'error');
            store.addMember(email, who.value); ui.toast('Accès ajouté. La personne peut créer son compte avec cette adresse.');
          } }, 'Autoriser')));
        }
        root.appendChild(acc);

        /* Données */
        var data = h('section', { class: 'panel' }, h('h2', {}, 'Données'),
          h('div', { class: 'actions actions-start' },
            h('button', { type: 'button', class: 'btn', onclick: K.actions.importDialog }, 'Importer des joueurs'),
            h('button', { type: 'button', class: 'btn', onclick: function () {
              var copy = JSON.parse(JSON.stringify(st)); copy.players.forEach(function (p) { if (p.photo_path && p.photo_path.indexOf('data:') === 0) p.photo_path = null; }); delete copy.members;
              download('killer-qg-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(copy, null, 2));
            } }, 'Télécharger une sauvegarde'),
            store.mode !== 'supabase' ? h('button', { type: 'button', class: 'btn', onclick: function () { store.resetDemo().then(function () { ui.toast('Partie de démo rechargée.'); }); } }, 'Recharger la démo') : null),
          h('h3', {}, 'Journal'),
          h('p', { class: 'prose' }, 'Vide la liste « Dernières infos » du dashboard (' + st.events.length + ' lignes). Les kills, les liens et les fiches ne bougent pas.'),
          h('div', { class: 'actions actions-start' }, h('button', { type: 'button', class: 'btn', disabled: !st.events.length, onclick: function () {
            ui.confirm({ title: 'Vider le journal ?', text: 'Les ' + st.events.length + ' dernières infos disparaissent pour toute l\'équipe. Rien d\'autre n\'est touché.', action: 'Vider le journal', danger: true })
              .then(function (ok) { if (ok) store.clearEvents().then(function () { ui.toast('Journal vidé.'); }); });
          } }, 'Vider le journal')),
          h('h3', {}, 'Fin de partie'),
          h('p', { class: 'prose' }, 'Efface les fiches, les photos, les chaînes, les kills et le journal. Le catalogue d\'armes, le shop et les réglages restent pour l\'an prochain.'),
          h('div', { class: 'actions actions-start' }, h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            ui.confirm({ title: 'Tout effacer ?', text: ['Les ' + st.players.length + ' fiches et leurs photos seront supprimées pour toute l\'équipe. C\'est irréversible.', 'Télécharge une sauvegarde avant si tu veux garder les statistiques.'], action: 'Effacer la partie', danger: true })
              .then(function (ok) { if (ok) store.purge().then(function () { ui.toast('Partie effacée.'); }); });
          } }, 'Effacer la partie')));
        root.appendChild(data);

        /* Appareil + compte */
        var theme = 'auto'; try { theme = localStorage.getItem('killer-qg-theme') || 'auto'; } catch (e) { /* rien */ }
        root.appendChild(h('section', { class: 'panel' }, h('h2', {}, 'Cet appareil'),
          ui.field('Thème', ui.select([{ value: 'auto', label: 'Comme le système' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }], theme, { onchange: function (e) { K.setTheme(e.target.value); } })),
          store.mode === 'supabase' ? h('div', { class: 'row' }, h('span', { class: 'row-main muted' }, 'Connecté : ' + store.user.email), h('button', { type: 'button', class: 'btn', onclick: function () { store.auth.signOut(); } }, 'Se déconnecter')) : null));
      }
      refresh();
      return refresh;
    }
  };
})();
