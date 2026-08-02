import { ref, onScopeDispose } from "vue";

const QUERY = "(max-width: 768px)";

export function useMobile() {
  const query = window.matchMedia(QUERY);
  const isMobile = ref(query.matches);

  const update = (event) => (isMobile.value = event.matches);
  query.addEventListener("change", update);
  onScopeDispose(() => query.removeEventListener("change", update));

  return isMobile;
}
