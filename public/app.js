const $ = selector => document.querySelector(selector);
let token = '';
let author;
let runId = 'manual';
let editingId;
let busy = false;
function notice(message, error = false) {$('#notice').textContent = message; $('#notice').classList.toggle('error',error);}
function logout() {
  token = ''; author = undefined;
  if ($('#edit-dialog').open) $('#edit-dialog').close();
  $('#workspace').hidden = true; $('#login-panel').hidden = false; $('#tasks').replaceChildren();
  $('#author').textContent = ''; $('#token').value = ''; $('#token').focus();
}
async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {...options,headers:{Authorization:`Bearer ${token}`,...(options.body ? {'Content-Type':'application/json'} : {})},cache:'no-store'});
  if (response.status === 401) {logout(); throw new Error('Неверный токен. Введите действующий токен доступа.');}
  if (!response.ok) {
    const data = await response.json();
    throw new Error(response.status === 503 ? 'База данных недоступна. Попробуйте обновить список позже.' : data.error);
  }
  return response.status === 204 ? undefined : response.json();
}
async function action(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(button => {button.disabled = true;});
  try {await work();} catch (error) {notice(error.message || 'Не удалось связаться с сервером.',true);}
  finally {busy = false; document.querySelectorAll('button').forEach(button => {button.disabled = false;});}
}
function titleValue(input) {
  const value = input.value.trim();
  if ([...value].length < 1 || [...value].length > 200) throw new Error('Введите название от 1 до 200 символов.');
  return value;
}
async function load() {
  const tasks = await api(`tasks/?runId=${encodeURIComponent(runId)}`);
  $('#tasks').replaceChildren(...tasks.map(task => {
    const li = document.createElement('li'); li.className = `task${task.done ? ' done' : ''}`; li.dataset.id = task.id;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = task.done;
    checkbox.setAttribute('aria-label',`Выполнено: ${task.title}`);
    checkbox.addEventListener('change',() => {
      if (busy) {checkbox.checked = task.done; return;}
      action(async () => {
        try {
          await api(`tasks/${task.id}/`,{method:'PATCH',body:JSON.stringify({done:checkbox.checked})});
          await load();
          [...$('#tasks').children].find(item => item.dataset.id === task.id)?.querySelector('input[type="checkbox"]')?.focus();
          notice('Статус сохранён.');
        }
        catch (error) {checkbox.checked = task.done; throw error;}
      });
    });
    const title = document.createElement('p'); title.className = 'task-title'; title.textContent = task.title;
    const controls = document.createElement('div'); controls.className = 'task-actions';
    const edit = document.createElement('button'); edit.className = 'secondary'; edit.textContent = 'Изменить';
    edit.setAttribute('aria-label',`Изменить: ${task.title}`);
    edit.addEventListener('click',() => {editingId=task.id; $('#edit-title').value=task.title; $('#edit-error').textContent=''; $('#edit-dialog').showModal(); $('#edit-title').focus();});
    const remove = document.createElement('button'); remove.className = 'secondary danger'; remove.textContent = 'Удалить';
    remove.setAttribute('aria-label',`Удалить: ${task.title}`);
    remove.addEventListener('click',() => action(async () => {
      if (!confirm(`Удалить дело «${task.title}»?`)) return;
      await api(`tasks/${task.id}/`,{method:'DELETE'}); await load(); notice('Дело удалено.'); $('#refresh').focus();
    }));
    controls.append(edit,remove); li.append(checkbox,title,controls); return li;
  }));
  $('#count').textContent=`Выполнено ${tasks.filter(task => task.done).length} из ${tasks.length}`;
  $('#empty').hidden=tasks.length>0;
}
$('#login-form').addEventListener('submit',event => {event.preventDefault(); action(async () => {
  token=$('#token').value.trim(); author=await api('author/'); $('#token').value='';
  $('#author').textContent=`${author.fullName} · ${author.login}`;
  $('#login-panel').hidden=true; $('#workspace').hidden=false;
  await load(); notice('Вы вошли. Список загружен из базы данных.'); $('#title').focus();
});});
$('#logout').addEventListener('click',() => {logout(); notice('Вы вышли. Токен удалён из памяти вкладки.');});
$('#add-form').addEventListener('submit',event => {event.preventDefault(); action(async () => {
  await api('tasks/',{method:'POST',body:JSON.stringify({title:titleValue($('#title')),runId})});
  $('#title').value=''; await load(); notice('Дело добавлено.'); $('#title').focus();
});});
$('#filter-form').addEventListener('submit',event => {event.preventDefault(); action(async () => {runId=$('#run-id').value; await load(); notice('Группа загружена.');});});
$('#refresh').addEventListener('click',() => action(async () => {await load(); notice('Данные обновлены из базы.');}));
$('#personal-task').addEventListener('click',() => action(async () => {
  const title=`Итоговая работа 24.10.2026: ${author.login}`;
  const tasks=await api('tasks/?runId=manual');
  if (!tasks.some(task => task.title === title)) await api('tasks/',{method:'POST',body:JSON.stringify({title,runId:'manual'})});
  runId='manual'; $('#run-id').value=runId; await load(); notice('Персональное дело находится в группе manual.');
}));
$('#cancel-edit').addEventListener('click',() => $('#edit-dialog').close());
$('#edit-form').addEventListener('submit',event => {event.preventDefault(); action(async () => {
  try {
    await api(`tasks/${editingId}/`,{method:'PATCH',body:JSON.stringify({title:titleValue($('#edit-title'))})});
    $('#edit-dialog').close(); await load(); notice('Название сохранено.');
    ([...$('#tasks').children].find(item => item.dataset.id === editingId)?.querySelector('.task-actions button') || $('#refresh')).focus();
  } catch (error) {$('#edit-error').textContent=error.message; throw error;}
});});
