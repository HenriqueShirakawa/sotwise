/**
 * Tipos do schema `public` do Supabase (projeto AGK).
 *
 * ⚠️ Escrito à mão a partir de `supabase/migrations/*.sql` (o MCP do Supabase não
 * alcança o projeto AGK e não há PAT nesta sessão para rodar `supabase gen types`).
 * Cobre a superfície desta fase: Auth + Registration (cadastros). As tabelas
 * transacionais (orders, batches, pre_loadings, shipments, checklist…) serão
 * adicionadas quando esses módulos forem construídos.
 *
 * Convenções: uuid/date/timestamptz → string. `NOT NULL` relaxados pelas
 * reconciliações (§12.7) estão como nullable. `bubble_id` (nullable) e
 * `deleted_at` (nullable) presentes conforme o schema real.
 */

type Timestamp = string;
type UUID = string;
type DateStr = string;

export type CompanyType = "BR" | "China";
export type UserStatus = "active" | "blocked";
export type AgentLocation = "brazil" | "china";
export type OrderStatus =
  | "in_negotiation"
  | "in_production"
  | "partially_shipped"
  | "shipped"
  | "partially_delivered"
  | "delivered"
  | "canceled";
export type BatchStatus =
  | "in_negotiation"
  | "in_production"
  | "preloading"
  | "in_transit"
  | "delivered"
  | "canceled";
export type LoadingStatus = "total" | "partial" | "none";
export type ChecklistPhase = "order" | "preloading" | "shipment";
export type ChecklistStep =
  | "order"
  | "po"
  | "pi"
  | "deposit_payment"
  | "packing_confirm"
  | "condition_confirm"
  | "place_the_order"
  | "etd"
  | "balance_payment"
  | "pre_loading"
  | "consolidation_point"
  | "city"
  | "port_of_loading"
  | "shipping_docs"
  | "agents"
  | "booking"
  | "loading_date"
  | "shipping_date"
  | "bl"
  | "original_docs"
  | "inspection_report"
  | "eta_brazil"
  | "ata_brazil"
  | "delivered";

export type Database = {
  public: {
    Tables: {
      roles: {
        Row: {
          id: UUID;
          name: string;
          created_at: Timestamp;
          updated_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["roles"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: UUID;
          full_name: string;
          date_of_birth: DateStr | null;
          role_id: UUID;
          company: CompanyType;
          status: UserStatus;
          hidden: boolean;
          slug: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id: UUID;
          full_name: string;
          date_of_birth?: DateStr | null;
          role_id: UUID;
          company: CompanyType;
          status?: UserStatus;
          hidden?: boolean;
          slug?: string | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      activity_logs: {
        Row: {
          id: UUID;
          user_id: UUID;
          action: string;
          entity_type: string | null;
          entity_id: UUID | null;
          metadata: Record<string, unknown> | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          user_id: UUID;
          action: string;
          entity_type?: string | null;
          entity_id?: UUID | null;
          metadata?: Record<string, unknown> | null;
          created_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["activity_logs"]["Insert"]>;
        Relationships: [];
      };
      countries: {
        Row: {
          id: UUID;
          name: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["countries"]["Insert"]>;
        Relationships: [];
      };
      pols: {
        Row: {
          id: UUID;
          name: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["pols"]["Insert"]>;
        Relationships: [];
      };
      pods: {
        Row: {
          id: UUID;
          name: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["pods"]["Insert"]>;
        Relationships: [];
      };
      cities: {
        Row: {
          id: UUID;
          name: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["cities"]["Insert"]>;
        Relationships: [];
      };
      city_pols: {
        Row: { city_id: UUID; pol_id: UUID };
        Insert: { city_id: UUID; pol_id: UUID };
        Update: Partial<{ city_id: UUID; pol_id: UUID }>;
        Relationships: [];
      };
      factories: {
        Row: {
          id: UUID;
          name: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["factories"]["Insert"]>;
        Relationships: [];
      };
      categories: {
        Row: {
          id: UUID;
          name: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      category_factories: {
        Row: { category_id: UUID; factory_id: UUID };
        Insert: { category_id: UUID; factory_id: UUID };
        Update: Partial<{ category_id: UUID; factory_id: UUID }>;
        Relationships: [];
      };
      contacts: {
        Row: {
          id: UUID;
          name: string;
          email: string | null;
          email_na: boolean;
          phone_number: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          email?: string | null;
          email_na?: boolean;
          phone_number: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["contacts"]["Insert"]>;
        Relationships: [];
      };
      agents: {
        Row: {
          id: UUID;
          name: string;
          country_id: UUID | null;
          location: AgentLocation | null;
          email: string | null;
          email_na: boolean;
          phone_number: string | null;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          country_id?: UUID | null;
          location?: AgentLocation | null;
          email?: string | null;
          email_na?: boolean;
          phone_number?: string | null;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["agents"]["Insert"]>;
        Relationships: [];
      };
      agent_contacts: {
        Row: { agent_id: UUID; contact_id: UUID };
        Insert: { agent_id: UUID; contact_id: UUID };
        Update: Partial<{ agent_id: UUID; contact_id: UUID }>;
        Relationships: [];
      };
      carriers: {
        Row: {
          id: UUID;
          name: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["carriers"]["Insert"]>;
        Relationships: [];
      };
      carrier_agents: {
        Row: { carrier_id: UUID; agent_id: UUID };
        Insert: { carrier_id: UUID; agent_id: UUID };
        Update: Partial<{ carrier_id: UUID; agent_id: UUID }>;
        Relationships: [];
      };
      clients: {
        Row: {
          id: UUID;
          name: string;
          country_id: UUID | null;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          country_id?: UUID | null;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
        Relationships: [];
      };
      exporters: {
        Row: {
          id: UUID;
          name: string;
          acronym: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          acronym: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["exporters"]["Insert"]>;
        Relationships: [];
      };
      business_units: {
        Row: {
          id: UUID;
          name: string;
          icon_path: string | null;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          icon_path?: string | null;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["business_units"]["Insert"]>;
        Relationships: [];
      };
      order_types: {
        Row: {
          id: UUID;
          name: string;
          icon_path: string | null;
          color: string | null;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          icon_path?: string | null;
          color?: string | null;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["order_types"]["Insert"]>;
        Relationships: [];
      };
      shipment_models: {
        Row: {
          id: UUID;
          name: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["shipment_models"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: UUID;
          po_number: string;
          order_type_id: UUID | null;
          schedule_requested: DateStr | null;
          asap: boolean;
          client_id: UUID | null;
          client_reference: string | null;
          business_unit_id: UUID | null;
          requester_id: UUID | null;
          exporter_id: UUID | null;
          leader_id: UUID | null;
          status: OrderStatus;
          date_po: DateStr | null;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          po_number: string;
          order_type_id?: UUID | null;
          schedule_requested?: DateStr | null;
          asap?: boolean;
          client_id?: UUID | null;
          client_reference?: string | null;
          business_unit_id?: UUID | null;
          requester_id?: UUID | null;
          exporter_id?: UUID | null;
          leader_id?: UUID | null;
          status?: OrderStatus;
          date_po?: DateStr | null;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      batches: {
        Row: {
          id: UUID;
          order_id: UUID;
          batch_number: string;
          status: BatchStatus;
          split_from_batch_id: UUID | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          order_id: UUID;
          batch_number: string;
          status?: BatchStatus;
          split_from_batch_id?: UUID | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["batches"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      company_type: CompanyType;
      user_status: UserStatus;
      agent_location: AgentLocation;
      order_status: OrderStatus;
      batch_status: BatchStatus;
      loading_status: LoadingStatus;
      checklist_phase: ChecklistPhase;
      checklist_step: ChecklistStep;
    };
    CompositeTypes: Record<never, never>;
  };
};

/* ---- Helpers no estilo do supabase gen types ---- */
type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T];
