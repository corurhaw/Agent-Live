import './styles.css';
import { api } from '@appdeploy/client';

const count = document.querySelector<HTMLParagraphElement>('#count')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!;
const requestId = crypto.randomUUID();
let registered = false;

async function updateTotal() {
  refresh.disabled = true;
  status.classList.remove('error');
  try {
    const response = registered
      ? await api.get('/api/visits')
      : await api.post('/api/visits', { requestId });
    const total: unknown = response.data.total;
    if (
      typeof total !== 'number' ||
      !Number.isSafeInteger(total) ||
      total < 0
    ) {
      throw new Error('Invalid counter response');
    }
    registered = true;
    count.textContent = total.toLocaleString();
    status.textContent = 'Your hello is part of the total.';
    refresh.innerHTML = 'Refresh total <span aria-hidden="true">↗</span>';
  } catch {
    status.classList.add('error');
    status.textContent = 'Could not connect to the counter. Please try again.';
    refresh.textContent = 'Try again ↗';
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener('click', () => void updateTotal());
void updateTotal();
