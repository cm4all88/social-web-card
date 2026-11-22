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
      checkout_attempts: {
        Row: {
          created_at: string
          creator_user_id: string
          id: number
          ip_hash: string
        }
        Insert: {
          created_at?: string
          creator_user_id: string
          id?: never
          ip_hash: string
        }
        Update: {
          created_at?: string
          creator_user_id?: string
          id?: never
          ip_hash?: string
        }
        Relationships: []
      }
      creator_payment_accounts: {
        Row: {
          tipping_suspended_at: string | null
          tipping_suspended_reason: string | null
          charges_enabled: boolean
          country: string | null
          created_at: string
          default_currency: string | null
          details_submitted: boolean
          disabled_reason: string | null
          livemode: boolean
          payouts_enabled: boolean
          requirements_due_count: number
          status: string
          stripe_account_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          tipping_suspended_at?: string | null
          tipping_suspended_reason?: string | null
          charges_enabled?: boolean
          country?: string | null
          created_at?: string
          default_currency?: string | null
          details_submitted?: boolean
          disabled_reason?: string | null
          livemode?: boolean
          payouts_enabled?: boolean
          requirements_due_count?: number
          status?: string
          stripe_account_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          tipping_suspended_at?: string | null
          tipping_suspended_reason?: string | null
          charges_enabled?: boolean
          country?: string | null
          created_at?: string
          default_currency?: string | null
          details_submitted?: boolean
          disabled_reason?: string | null
          livemode?: boolean
          payouts_enabled?: boolean
          requirements_due_count?: number
          status?: string
          stripe_account_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invites: {
        Row: {
          code: string
          created_at: string
          created_by: string
          id: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          id?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          id?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          custom_theme: Json | null
          display_name: string | null
          id: string
          theme: string
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          custom_theme?: Json | null
          display_name?: string | null
          id?: string
          theme?: string
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          custom_theme?: Json | null
          display_name?: string | null
          id?: string
          theme?: string
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      social_links: {
        Row: {
          created_at: string
          display_order: number
          enabled: boolean
          featured: boolean
          icon: string | null
          id: string
          platform: string
          section_id: string | null
          title: string | null
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          enabled?: boolean
          featured?: boolean
          icon?: string | null
          id?: string
          platform: string
          section_id?: string | null
          title?: string | null
          updated_at?: string
          url?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          enabled?: boolean
          featured?: boolean
          icon?: string | null
          id?: string
          platform?: string
          section_id?: string | null
          title?: string | null
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      link_sections: {
        Row: {
          created_at: string
          display_order: number
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          attempts: number
          claimed_at: string | null
          account: string | null
          id: string
          livemode: boolean
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          account?: string | null
          id: string
          livemode?: boolean
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          account?: string | null
          id?: string
          livemode?: boolean
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      tip_settings: {
        Row: {
          attested_at: string | null
          creator_type: string | null
          offering: string | null
          button_text: string
          created_at: string
          enabled: boolean
          show_on_profile: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          attested_at?: string | null
          creator_type?: string | null
          offering?: string | null
          button_text?: string
          created_at?: string
          enabled?: boolean
          show_on_profile?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          attested_at?: string | null
          creator_type?: string | null
          offering?: string | null
          button_text?: string
          created_at?: string
          enabled?: boolean
          show_on_profile?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tips: {
        Row: {
          application_fee_cents: number | null
          application_fee_id: string | null
          amount_refunded_cents: number
          charge_id: string | null
          checkout_session_id: string | null
          created_at: string
          creator_user_id: string
          currency: string
          dispute_amount_cents: number | null
          dispute_status: string | null
          id: string
          livemode: boolean
          paid_at: string | null
          payment_intent_id: string | null
          platform_fee_cents: number
          platform_fee_refunded_cents: number
          source: string
          status: string
          stripe_account_id: string
          supporter_message: string | null
          supporter_name: string | null
          tip_amount_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          application_fee_cents?: number | null
          application_fee_id?: string | null
          amount_refunded_cents?: number
          charge_id?: string | null
          checkout_session_id?: string | null
          created_at?: string
          creator_user_id: string
          currency?: string
          dispute_amount_cents?: number | null
          dispute_status?: string | null
          id?: string
          livemode?: boolean
          paid_at?: string | null
          payment_intent_id?: string | null
          platform_fee_cents: number
          platform_fee_refunded_cents?: number
          source?: string
          status?: string
          stripe_account_id: string
          supporter_message?: string | null
          supporter_name?: string | null
          tip_amount_cents: number
          total_cents: number
          updated_at?: string
        }
        Update: {
          application_fee_cents?: number | null
          application_fee_id?: string | null
          amount_refunded_cents?: number
          charge_id?: string | null
          checkout_session_id?: string | null
          created_at?: string
          creator_user_id?: string
          currency?: string
          dispute_amount_cents?: number | null
          dispute_status?: string | null
          id?: string
          livemode?: boolean
          paid_at?: string | null
          payment_intent_id?: string | null
          platform_fee_cents?: number
          platform_fee_refunded_cents?: number
          source?: string
          status?: string
          stripe_account_id?: string
          supporter_message?: string | null
          supporter_name?: string | null
          tip_amount_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wishlist_items: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          image_url: string | null
          name: string
          price_text: string | null
          updated_at: string
          url: string | null
          user_id: string
          wishlist_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string | null
          name: string
          price_text?: string | null
          updated_at?: string
          url?: string | null
          user_id: string
          wishlist_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string | null
          name?: string
          price_text?: string | null
          updated_at?: string
          url?: string | null
          user_id?: string
          wishlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_wishlist_id_fkey"
            columns: ["wishlist_id"]
            isOneToOne: false
            referencedRelation: "wishlists"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlists: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          event_date: string | null
          id: string
          occasion: string | null
          show_on_profile: boolean
          slug: string
          title: string
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          event_date?: string | null
          id?: string
          occasion?: string | null
          show_on_profile?: boolean
          slug: string
          title: string
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          event_date?: string | null
          id?: string
          occasion?: string | null
          show_on_profile?: boolean
          slug?: string
          title?: string
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_tip_report: { Args: { _since?: string }; Returns: Json }
      admin_set_tip_suspension: {
        Args: { _username: string; _suspended: boolean; _reason?: string }
        Returns: boolean
      }
      claim_stripe_event: {
        Args: {
          _id: string
          _type: string
          _account?: string
          _livemode: boolean
          _lease_seconds?: number
        }
        Returns: string
      }
      record_checkout_attempt: {
        Args: {
          _ip_hash: string
          _creator_user_id: string
          _ip_limit: number
          _ip_window_seconds: number
          _creator_limit: number
          _creator_window_seconds: number
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invite_is_valid: { Args: { _code: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
