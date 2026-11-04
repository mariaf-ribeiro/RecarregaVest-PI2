
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
  const url = 'http://localhost:3000/api/comunidades/geral/postagens';

  const response = http.get(url);

  check(response, {
    'status HTTP 200': (r) => r.status === 200,
    'resposta contém postagens': (r) => {
      try {
        return Array.isArray(r.json('postagens'));
      } catch (error) {
        return false;
      }
    },
  });

  sleep(1);
}
