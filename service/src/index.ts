export { Person } from './person.ts';

export default {
  fetch(): Response {
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
