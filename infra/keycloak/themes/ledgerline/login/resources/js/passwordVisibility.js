// Preserve Keycloak's form and CSRF flow; replace only its presentation control.
document.querySelectorAll('[data-password-toggle]').forEach(button => {
  const input = document.getElementById(button.getAttribute('aria-controls'));
  if (!(input instanceof HTMLInputElement)) return;
  const icon = document.createElement('img');
  icon.width = 18;
  icon.height = 18;
  icon.alt = '';
  button.replaceChildren(icon);
  const update = () => {
    const visible = input.type === 'text';
    icon.src = new URL(`../img/${visible ? 'eye-off' : 'eye'}.svg`, import.meta.url).href;
    button.setAttribute('aria-label', visible ? button.dataset.labelHide : button.dataset.labelShow);
    button.setAttribute('aria-pressed', String(visible));
    button.dataset.visible = String(visible);
  };
  update();
  button.onclick = null;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    input.type = input.type === 'password' ? 'text' : 'password';
    update();
  }, { capture: true });
  button.disabled = false;
  const error = document.getElementById(`input-error-${input.id}`);
  if (error) input.setAttribute('aria-describedby', error.id);
});

const registrationPassword = document.querySelector('#kc-register-form #password');
if (registrationPassword) {
  const help = document.createElement('p');
  help.className = 'll-password-help';
  help.id = 'password-guidance';
  help.textContent = 'Use at least 12 characters. Do not use your email as your password.';
  registrationPassword.closest('.input-group')?.insertAdjacentElement('afterend', help);
  const descriptions = [registrationPassword.getAttribute('aria-describedby'), help.id].filter(Boolean);
  registrationPassword.setAttribute('aria-describedby', descriptions.join(' '));
}
