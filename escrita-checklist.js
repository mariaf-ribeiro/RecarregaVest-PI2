import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '30s', target: 20 },
    { duration: '1m', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const url = 'http://localhost:3000/api/checklists/6/itens';

  const dados = JSON.stringify({
    data: '2026-11-04',
    descricao: `Teste de carga VU ${__VU} iteracao ${__ITER}`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.post(url, dados, params);

  check(response, {
    'status HTTP 200': (r) => r.status === 200,
    'resposta confirma operação': (r) => {
      try {
        return r.json('mensagem') === 'Operação de checklist concluída.';
      } catch (error) {
        return false;
      }
    },
  });

  sleep(1);
}