export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agenda_blocks: {
        Row: {
          created_at: string
          ends_at: string
          force_overlap: boolean
          id: string
          owner_id: string
          professional_id: string | null
          reason: string | null
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          force_overlap?: boolean
          id?: string
          owner_id: string
          professional_id?: string | null
          reason?: string | null
          starts_at: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          force_overlap?: boolean
          id?: string
          owner_id?: string
          professional_id?: string | null
          reason?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_blocks_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          client_id: string
          created_at: string
          ends_at: string
          force_overlap: boolean
          id: string
          notes: string | null
          owner_id: string
          price: number
          professional_id: string | null
          service_id: string | null
          service_name: string | null
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          ends_at: string
          force_overlap?: boolean
          id?: string
          notes?: string | null
          owner_id: string
          price?: number
          professional_id?: string | null
          service_id?: string | null
          service_name?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          ends_at?: string
          force_overlap?: boolean
          id?: string
          notes?: string | null
          owner_id?: string
          price?: number
          professional_id?: string | null
          service_id?: string | null
          service_name?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_materials: {
        Row: {
          appointment_id: string
          created_at: string
          id: string
          owner_id: string
          product_id: string
          quantity: number
        }
        Insert: {
          appointment_id: string
          created_at?: string
          id?: string
          owner_id: string
          product_id: string
          quantity?: number
        }
        Update: {
          appointment_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_materials_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          details: Json | null
          id: string
          ip: string | null
          owner_id: string
          resource: string
          resource_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          ip?: string | null
          owner_id: string
          resource: string
          resource_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          ip?: string | null
          owner_id?: string
          resource?: string
          resource_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      client_anamnesis: {
        Row: {
          allergies: string | null
          client_id: string
          contraindications: string | null
          medications: string | null
          notes: string | null
          owner_id: string
          pregnant: boolean | null
          restrictions: string | null
          skin_type: string | null
          updated_at: string
        }
        Insert: {
          allergies?: string | null
          client_id: string
          contraindications?: string | null
          medications?: string | null
          notes?: string | null
          owner_id: string
          pregnant?: boolean | null
          restrictions?: string | null
          skin_type?: string | null
          updated_at?: string
        }
        Update: {
          allergies?: string | null
          client_id?: string
          contraindications?: string | null
          medications?: string | null
          notes?: string | null
          owner_id?: string
          pregnant?: boolean | null
          restrictions?: string | null
          skin_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_anamnesis_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_photos: {
        Row: {
          appointment_id: string | null
          caption: string | null
          client_id: string
          created_at: string
          id: string
          kind: string
          owner_id: string
          storage_path: string
        }
        Insert: {
          appointment_id?: string | null
          caption?: string | null
          client_id: string
          created_at?: string
          id?: string
          kind?: string
          owner_id: string
          storage_path: string
        }
        Update: {
          appointment_id?: string | null
          caption?: string | null
          client_id?: string
          created_at?: string
          id?: string
          kind?: string
          owner_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_photos_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_photos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          avatar_url: string | null
          birthday: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          owner_id: string
          phone: string | null
          tags: string[]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          owner_id: string
          phone?: string | null
          tags?: string[]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          owner_id?: string
          phone?: string | null
          tags?: string[]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      finance_goals: {
        Row: {
          active: boolean
          amount: number
          created_at: string
          ends_at: string | null
          id: string
          owner_id: string
          period: string
          scope: string
          scope_ref: string | null
          starts_at: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount?: number
          created_at?: string
          ends_at?: string | null
          id?: string
          owner_id: string
          period: string
          scope?: string
          scope_ref?: string | null
          starts_at?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number
          created_at?: string
          ends_at?: string | null
          id?: string
          owner_id?: string
          period?: string
          scope?: string
          scope_ref?: string | null
          starts_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      finance_settings: {
        Row: {
          commission_default_pct: number
          fixed_costs_monthly: number
          owner_id: string
          prolabore_monthly: number
          tax_pct: number
          tax_regime: string | null
          updated_at: string
        }
        Insert: {
          commission_default_pct?: number
          fixed_costs_monthly?: number
          owner_id: string
          prolabore_monthly?: number
          tax_pct?: number
          tax_regime?: string | null
          updated_at?: string
        }
        Update: {
          commission_default_pct?: number
          fixed_costs_monthly?: number
          owner_id?: string
          prolabore_monthly?: number
          tax_pct?: number
          tax_regime?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      finance_transactions: {
        Row: {
          amount: number
          appointment_id: string | null
          auto: boolean
          category: string | null
          client_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          installment_index: number | null
          installments: number
          kind: string
          method: string | null
          owner_id: string
          paid_at: string | null
          parent_id: string | null
          service_id: string | null
          status: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          amount?: number
          appointment_id?: string | null
          auto?: boolean
          category?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          installment_index?: number | null
          installments?: number
          kind: string
          method?: string | null
          owner_id: string
          paid_at?: string | null
          parent_id?: string | null
          service_id?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          auto?: boolean
          category?: string | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          installment_index?: number | null
          installments?: number
          kind?: string
          method?: string | null
          owner_id?: string
          paid_at?: string | null
          parent_id?: string | null
          service_id?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      product_batches: {
        Row: {
          batch_number: string | null
          created_at: string
          expires_at: string | null
          id: string
          initial_quantity: number
          manufactured_at: string | null
          notes: string | null
          owner_id: string
          product_id: string
          remaining_quantity: number
          supplier_id: string | null
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          batch_number?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          initial_quantity?: number
          manufactured_at?: string | null
          notes?: string | null
          owner_id: string
          product_id: string
          remaining_quantity?: number
          supplier_id?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          batch_number?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          initial_quantity?: number
          manufactured_at?: string | null
          notes?: string | null
          owner_id?: string
          product_id?: string
          remaining_quantity?: number
          supplier_id?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          barcode: string | null
          brand: string | null
          category: string | null
          cost_per_unit: number
          created_at: string
          description: string | null
          id: string
          ideal_stock: number | null
          image_url: string | null
          internal_code: string | null
          last_purchase_cost: number | null
          last_purchase_qty: number | null
          location: string | null
          max_stock: number | null
          min_stock: number
          name: string
          notes: string | null
          owner_id: string
          sku: string | null
          stock: number
          subcategory: string | null
          supplier: string | null
          supplier_id: string | null
          unit: string
          updated_at: string
          yield_per_unit: number | null
        }
        Insert: {
          active?: boolean
          barcode?: string | null
          brand?: string | null
          category?: string | null
          cost_per_unit?: number
          created_at?: string
          description?: string | null
          id?: string
          ideal_stock?: number | null
          image_url?: string | null
          internal_code?: string | null
          last_purchase_cost?: number | null
          last_purchase_qty?: number | null
          location?: string | null
          max_stock?: number | null
          min_stock?: number
          name: string
          notes?: string | null
          owner_id: string
          sku?: string | null
          stock?: number
          subcategory?: string | null
          supplier?: string | null
          supplier_id?: string | null
          unit?: string
          updated_at?: string
          yield_per_unit?: number | null
        }
        Update: {
          active?: boolean
          barcode?: string | null
          brand?: string | null
          category?: string | null
          cost_per_unit?: number
          created_at?: string
          description?: string | null
          id?: string
          ideal_stock?: number | null
          image_url?: string | null
          internal_code?: string | null
          last_purchase_cost?: number | null
          last_purchase_qty?: number | null
          location?: string | null
          max_stock?: number | null
          min_stock?: number
          name?: string
          notes?: string | null
          owner_id?: string
          sku?: string | null
          stock?: number
          subcategory?: string | null
          supplier?: string | null
          supplier_id?: string | null
          unit?: string
          updated_at?: string
          yield_per_unit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          business_name: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          profession: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          business_name?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          profession?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          business_name?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          profession?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      service_materials: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          product_id: string
          quantity: number
          service_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          product_id: string
          quantity?: number
          service_id: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          product_id?: string
          quantity?: number
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_materials_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          description: string | null
          duration_min: number
          id: string
          name: string
          owner_id: string
          price: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          duration_min?: number
          id?: string
          name: string
          owner_id: string
          price?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          duration_min?: number
          id?: string
          name?: string
          owner_id?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          appointment_id: string | null
          created_at: string
          id: string
          kind: string
          note: string | null
          owner_id: string
          product_id: string
          quantity: number
          unit_cost: number | null
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          owner_id: string
          product_id: string
          quantity: number
          unit_cost?: number | null
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          owner_id?: string
          product_id?: string
          quantity?: number
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          address: string | null
          avg_delivery_days: number | null
          cnpj: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          instagram: string | null
          name: string
          notes: string | null
          owner_id: string
          phone: string | null
          rating: number | null
          updated_at: string
          website: string | null
          whatsapp: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          avg_delivery_days?: number | null
          cnpj?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          instagram?: string | null
          name: string
          notes?: string | null
          owner_id: string
          phone?: string | null
          rating?: number | null
          updated_at?: string
          website?: string | null
          whatsapp?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          avg_delivery_days?: number | null
          cnpj?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          instagram?: string | null
          name?: string
          notes?: string | null
          owner_id?: string
          phone?: string | null
          rating?: number | null
          updated_at?: string
          website?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      team_members: {
        Row: {
          agenda_color: string | null
          avatar_url: string | null
          bio: string | null
          booking_slug: string | null
          commission_type: string
          commission_value: number
          created_at: string
          email: string | null
          full_name: string
          id: string
          instagram: string | null
          monthly_goal: number
          onboarding_completed: boolean
          owner_id: string
          phone: string | null
          profession: string | null
          role_title: string | null
          show_commission: boolean
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          agenda_color?: string | null
          avatar_url?: string | null
          bio?: string | null
          booking_slug?: string | null
          commission_type?: string
          commission_value?: number
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          instagram?: string | null
          monthly_goal?: number
          onboarding_completed?: boolean
          owner_id: string
          phone?: string | null
          profession?: string | null
          role_title?: string | null
          show_commission?: boolean
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          agenda_color?: string | null
          avatar_url?: string | null
          bio?: string | null
          booking_slug?: string | null
          commission_type?: string
          commission_value?: number
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          instagram?: string | null
          monthly_goal?: number
          onboarding_completed?: boolean
          owner_id?: string
          phone?: string | null
          profession?: string | null
          role_title?: string | null
          show_commission?: boolean
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      team_permissions: {
        Row: {
          action: string
          allowed: boolean
          id: string
          member_id: string
          owner_id: string
          resource: string
          updated_at: string
        }
        Insert: {
          action: string
          allowed?: boolean
          id?: string
          member_id: string
          owner_id: string
          resource: string
          updated_at?: string
        }
        Update: {
          action?: string
          allowed?: boolean
          id?: string
          member_id?: string
          owner_id?: string
          resource?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_permissions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_professionals: {
        Row: {
          agenda_color: string | null
          avatar_url: string | null
          bio: string | null
          booking_slug: string | null
          full_name: string | null
          id: string | null
          instagram: string | null
          owner_id: string | null
          role_title: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "staff"
      appointment_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff"],
      appointment_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
    },
  },
} as const
