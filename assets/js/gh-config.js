// Golden Hand lead intake configuration.
//
// Leave both values empty and the site runs in DEMO mode: enquiries are kept
// in the visitor's own browser only and nothing is sent anywhere.
//
// Fill them in (see docs/LEAD-INTAKE.md) and enquiries are stored in Supabase
// and the operator console at /leads.html becomes REAL.
//
// The anon key is designed to be public. Row-level security in
// supabase/leads.sql only lets it INSERT new leads; it cannot read them.
export const GH_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
