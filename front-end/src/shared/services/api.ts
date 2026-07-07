// Shim so the placed layout (which imports `@/shared/services/api`) uses the app's
// existing axios client (bearer + 401 handling). Default export = the client.
import { api } from '../../api/client';

export default api;
