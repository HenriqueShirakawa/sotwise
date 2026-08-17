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
  | "partially_preloading"
  | "pre_loading"
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
/** Registro ao qual uma thread de mensagens está ancorada. */
export type MessageEntity = "order" | "pre_loading" | "shipment";
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
      /** Concessão por papel. `feature_key` é validada contra o catálogo em
       * `domain/access/features.ts`, não por FK — o catálogo vive em código. */
      role_features: {
        Row: {
          role_id: UUID;
          feature_key: string;
          can_view: boolean;
          can_create: boolean;
          can_edit: boolean;
          can_delete: boolean;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          role_id: UUID;
          feature_key: string;
          can_view?: boolean;
          can_create?: boolean;
          can_edit?: boolean;
          can_delete?: boolean;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["role_features"]["Insert"]>;
        Relationships: [];
      };
      /** Exceção por usuário. `null` em cada can_* = herda do papel; `false`
       * explícito REVOGA o que o papel concede. */
      user_features: {
        Row: {
          user_id: UUID;
          feature_key: string;
          can_view: boolean | null;
          can_create: boolean | null;
          can_edit: boolean | null;
          can_delete: boolean | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          user_id: UUID;
          feature_key: string;
          can_view?: boolean | null;
          can_create?: boolean | null;
          can_edit?: boolean | null;
          can_delete?: boolean | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["user_features"]["Insert"]>;
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
          ui_preferences: Record<string, unknown>;
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
          ui_preferences?: Record<string, unknown>;
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
          gss_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
          gss_id?: string | null;
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
          gss_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
          gss_id?: string | null;
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
          gss_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
          gss_id?: string | null;
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
          gss_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
          gss_id?: string | null;
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
          gss_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
          gss_id?: string | null;
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
          gss_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
          gss_id?: string | null;
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
          gss_id: string | null;
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
          gss_id?: string | null;
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
          gss_id: string | null;
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
          gss_id?: string | null;
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
          gss_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
          gss_id?: string | null;
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
          gss_id: string | null;
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
          gss_id?: string | null;
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
          gss_id: string | null;
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
          gss_id?: string | null;
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
          gss_id: string | null;
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
          gss_id?: string | null;
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
          gss_id: string | null;
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
          gss_id?: string | null;
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
          gss_id: string | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
          bubble_id?: string | null;
          gss_id?: string | null;
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
      order_checklist_steps: {
        Row: {
          id: UUID;
          order_id: UUID;
          step: ChecklistStep;
          enabled: boolean;
          done: boolean;
          estimated_date: DateStr | null;
          responsible_id: UUID | null;
          completed_on: DateStr | null;
          signed_by_id: UUID | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          order_id: UUID;
          step: ChecklistStep;
          enabled?: boolean;
          done?: boolean;
          estimated_date?: DateStr | null;
          responsible_id?: UUID | null;
          completed_on?: DateStr | null;
          signed_by_id?: UUID | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["order_checklist_steps"]["Insert"]
        >;
        Relationships: [];
      };
      order_factory_category: {
        Row: {
          id: UUID;
          order_id: UUID;
          category_id: UUID;
          factory_id: UUID;
          batch_id: UUID | null;
          ship_requirement: DateStr;
          loading_status: LoadingStatus | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          order_id: UUID;
          category_id: UUID;
          factory_id: UUID;
          batch_id?: UUID | null;
          ship_requirement: DateStr;
          loading_status?: LoadingStatus | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: Partial<
          Database["public"]["Tables"]["order_factory_category"]["Insert"]
        >;
        Relationships: [];
      };
      etd_info: {
        Row: {
          id: UUID;
          order_factory_category_id: UUID;
          remarks: string | null;
          ready: boolean;
          ready_date: DateStr | null;
          inspection: boolean;
          dispatch_location_id: UUID | null;
          initial_date: DateStr | null;
          dispatch_date: DateStr | null;
          current_date: DateStr | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          order_factory_category_id: UUID;
          remarks?: string | null;
          ready?: boolean;
          ready_date?: DateStr | null;
          inspection?: boolean;
          dispatch_location_id?: UUID | null;
          initial_date?: DateStr | null;
          dispatch_date?: DateStr | null;
          current_date?: DateStr | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["etd_info"]["Insert"]>;
        Relationships: [];
      };
      etd_history: {
        Row: {
          id: UUID;
          etd_info_id: UUID;
          changed_fields: Record<string, unknown>;
          changed_by: UUID | null;
          changed_at: Timestamp;
          bubble_id: string | null;
        };
        Insert: {
          id?: UUID;
          etd_info_id: UUID;
          changed_fields: Record<string, unknown>;
          changed_by?: UUID | null;
          changed_at?: Timestamp;
          bubble_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["etd_history"]["Insert"]>;
        Relationships: [];
      };
      // Serve às duas origens de checklist: exatamente UMA de
      // checklist_step_id (Orders) / pre_loading_step_id (Pre-loading) é
      // preenchida por linha — check `step_attachments_one_owner` no banco.
      step_attachments: {
        Row: {
          id: UUID;
          checklist_step_id: UUID | null;
          pre_loading_step_id: UUID | null;
          factory_id: UUID | null;
          file_path: string;
          file_name: string | null;
          uploaded_by: UUID | null;
          created_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          checklist_step_id?: UUID | null;
          pre_loading_step_id?: UUID | null;
          factory_id?: UUID | null;
          file_path: string;
          file_name?: string | null;
          uploaded_by?: UUID | null;
          created_at?: Timestamp;
        };
        Update: Partial<
          Database["public"]["Tables"]["step_attachments"]["Insert"]
        >;
        Relationships: [];
      };
      pre_loadings: {
        Row: {
          id: UUID;
          pl_number: string;
          created_date: DateStr;
          client_reference: string | null;
          pod_id: UUID | null;
          responsible_signer_id: UUID | null;
          leader_id: UUID | null;
          booking_status: string | null;
          seal_number: string | null;
          shipping_confirmed_at: Timestamp | null;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
        };
        Insert: {
          id?: UUID;
          pl_number: string;
          created_date?: DateStr;
          client_reference?: string | null;
          pod_id?: UUID | null;
          responsible_signer_id?: UUID | null;
          leader_id?: UUID | null;
          booking_status?: string | null;
          seal_number?: string | null;
          shipping_confirmed_at?: Timestamp | null;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
        };
        Update: Partial<Database["public"]["Tables"]["pre_loadings"]["Insert"]>;
        Relationships: [];
      };
      shipments: {
        Row: {
          id: UUID;
          pre_loading_id: UUID;
          shipment_model_id: UUID | null;
          carrier_id: UUID | null;
          container_number: string | null;
          leader_id: UUID | null;
          signer_id: UUID | null;
          estimated_date: DateStr | null;
          status: string;
          deleted_at: Timestamp | null;
          created_at: Timestamp;
          updated_at: Timestamp;
          created_by: UUID | null;
        };
        Insert: {
          id?: UUID;
          pre_loading_id: UUID;
          shipment_model_id?: UUID | null;
          carrier_id?: UUID | null;
          container_number?: string | null;
          leader_id?: UUID | null;
          signer_id?: UUID | null;
          estimated_date?: DateStr | null;
          status?: string;
          deleted_at?: Timestamp | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
          created_by?: UUID | null;
        };
        Update: Partial<Database["public"]["Tables"]["shipments"]["Insert"]>;
        Relationships: [];
      };
      pre_loading_clients: {
        Row: { pre_loading_id: UUID; client_id: UUID };
        Insert: { pre_loading_id: UUID; client_id: UUID };
        Update: Partial<{ pre_loading_id: UUID; client_id: UUID }>;
        Relationships: [];
      };
      pre_loading_batches: {
        Row: { pre_loading_id: UUID; batch_id: UUID };
        Insert: { pre_loading_id: UUID; batch_id: UUID };
        Update: Partial<{ pre_loading_id: UUID; batch_id: UUID }>;
        Relationships: [];
      };
      pre_loading_checklist_steps: {
        Row: {
          id: UUID;
          pre_loading_id: UUID;
          step: ChecklistStep;
          done: boolean;
          estimated_date: DateStr | null;
          responsible_id: UUID | null;
          completed_on: DateStr | null;
          signed_by_id: UUID | null;
          notes: string | null;
          consolidation_point_id: UUID | null;
          city_id: UUID | null;
          pol_id: UUID | null;
          carrier_agent_id: UUID | null;
          agent_brazil_id: UUID | null;
          agent_china_id: UUID | null;
          contact_brazil_id: UUID | null;
          contact_china_id: UUID | null;
          booking_number: string | null;
          created_at: Timestamp;
          updated_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          pre_loading_id: UUID;
          step: ChecklistStep;
          done?: boolean;
          estimated_date?: DateStr | null;
          responsible_id?: UUID | null;
          completed_on?: DateStr | null;
          signed_by_id?: UUID | null;
          notes?: string | null;
          consolidation_point_id?: UUID | null;
          city_id?: UUID | null;
          pol_id?: UUID | null;
          carrier_agent_id?: UUID | null;
          agent_brazil_id?: UUID | null;
          agent_china_id?: UUID | null;
          contact_brazil_id?: UUID | null;
          contact_china_id?: UUID | null;
          booking_number?: string | null;
          created_at?: Timestamp;
          updated_at?: Timestamp;
        };
        Update: Partial<
          Database["public"]["Tables"]["pre_loading_checklist_steps"]["Insert"]
        >;
        Relationships: [];
      };
      messages: {
        Row: {
          id: UUID;
          entity_type: MessageEntity;
          entity_id: UUID;
          author_id: UUID;
          body: string;
          created_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          entity_type: MessageEntity;
          entity_id: UUID;
          author_id: UUID;
          body: string;
          created_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
        Relationships: [];
      };
      message_recipients: {
        Row: { message_id: UUID; user_id: UUID; read_at: Timestamp | null };
        Insert: { message_id: UUID; user_id: UUID; read_at?: Timestamp | null };
        Update: Partial<Database["public"]["Tables"]["message_recipients"]["Insert"]>;
        Relationships: [];
      };
      /** Cursor + resultado do pull das bibliotecas a partir do GSS (uma linha
       * por recurso). Ver supabase/migrations/20260811120000_gss_sync_state.sql
       * e docs/INTEGRACAO_GSS.md. */
      gss_sync_state: {
        Row: {
          resource: string;
          watermark: Timestamp | null;
          last_run_at: Timestamp | null;
          last_status: "ok" | "error" | null;
          last_error: string | null;
          rows_upserted: number;
          rows_deleted: number;
          updated_at: Timestamp;
        };
        Insert: {
          resource: string;
          watermark?: Timestamp | null;
          last_run_at?: Timestamp | null;
          last_status?: "ok" | "error" | null;
          last_error?: string | null;
          rows_upserted?: number;
          rows_deleted?: number;
          updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["gss_sync_state"]["Insert"]>;
        Relationships: [];
      };
      /** Espelho cru da leitura do GSS para o painel /access/gss (uma linha por
       * recurso+id). Gerado de máquina allowlistada, não pela Vercel. Ver
       * supabase/migrations/20260817120000_gss_snapshot.sql e INTEGRACAO_GSS §9.9. */
      gss_snapshot: {
        Row: {
          resource: string;
          gss_id: number;
          payload: Record<string, unknown>;
          fetched_at: Timestamp;
        };
        Insert: {
          resource: string;
          gss_id: number;
          payload: Record<string, unknown>;
          fetched_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["gss_snapshot"]["Insert"]>;
        Relationships: [];
      };
      /** Resultado da última geração do snapshot por recurso (carimbo + falha). */
      gss_snapshot_runs: {
        Row: {
          resource: string;
          fetched_at: Timestamp;
          count: number;
          ok: boolean;
          error: string | null;
        };
        Insert: {
          resource: string;
          fetched_at?: Timestamp;
          count?: number;
          ok?: boolean;
          error?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["gss_snapshot_runs"]["Insert"]>;
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
      message_entity: MessageEntity;
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
