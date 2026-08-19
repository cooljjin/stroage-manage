import type { Category, InventoryAction, Location, RecipeUsageUnit, StockStatus, UnitWeightUnit } from "./domain";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string;
          name: string;
          business_name: string | null;
          status: "active" | "inactive" | "pending_deletion";
          created_by: string | null;
          deletion_requested_at: string | null;
          purge_after: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          business_name?: string | null;
          status?: "active" | "inactive" | "pending_deletion";
          created_by?: string | null;
          deletion_requested_at?: string | null;
          purge_after?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          business_name?: string | null;
          status?: "active" | "inactive" | "pending_deletion";
          created_by?: string | null;
          deletion_requested_at?: string | null;
          purge_after?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      mutation_requests: {
        Row: {
          id: string;
          store_id: string;
          user_id: string;
          request_id: string;
          operation_type: string;
          result_json: Json | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          store_id: string;
          user_id: string;
          request_id: string;
          operation_type: string;
          result_json?: Json | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          result_json?: Json | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      store_invites: {
        Row: {
          id: string;
          store_id: string;
          email: string | null;
          role: "store_admin" | "staff";
          token: string;
          invited_by: string;
          accepted_by: string | null;
          accepted_at: string | null;
          expires_at: string;
          max_uses: number;
          used_count: number;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          email?: string | null;
          role?: "store_admin" | "staff";
          token?: string;
          invited_by: string;
          accepted_by?: string | null;
          accepted_at?: string | null;
          expires_at?: string;
          max_uses?: number;
          used_count?: number;
          revoked_at?: string | null;
          created_at?: string;
        };
        Update: {
          email?: string | null;
          role?: "store_admin" | "staff";
          token?: string;
          accepted_by?: string | null;
          accepted_at?: string | null;
          expires_at?: string;
          max_uses?: number;
          used_count?: number;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          store_id: string;
          barcode: string | null;
          name: string;
          category: Category;
          supplier_name: string | null;
          storage_type: string | null;
          default_location: Location;
          unit_name: string | null;
          unit_weight_enabled: boolean;
          unit_weight: number | null;
          unit_weight_unit: UnitWeightUnit | null;
          processing_required: boolean;
          processed_unit_weight: number | null;
          processed_unit_weight_unit: UnitWeightUnit | null;
          product_url: string | null;
          order_completed: boolean;
          confirmed_order_pending: boolean;
          urgent_order_requested: boolean;
          urgent_order_quantity: number | null;
          fresh_order_selected: boolean;
          fresh_order_selected_at: string | null;
          receipt_check_only: boolean;
          status_enabled: boolean;
          stock_status: StockStatus | null;
          minimum_stock: number;
          is_important: boolean;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          barcode?: string | null;
          name: string;
          category: Category;
          supplier_name?: string | null;
          storage_type?: string | null;
          default_location?: Location;
          unit_name?: string | null;
          unit_weight_enabled?: boolean;
          unit_weight?: number | null;
          unit_weight_unit?: UnitWeightUnit | null;
          processing_required?: boolean;
          processed_unit_weight?: number | null;
          processed_unit_weight_unit?: UnitWeightUnit | null;
          product_url?: string | null;
          order_completed?: boolean;
          confirmed_order_pending?: boolean;
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          fresh_order_selected?: boolean;
          fresh_order_selected_at?: string | null;
          receipt_check_only?: boolean;
          status_enabled?: boolean;
          stock_status?: StockStatus | null;
          minimum_stock?: number;
          is_important?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          store_id?: string;
          barcode?: string | null;
          name?: string;
          category?: Category;
          supplier_name?: string | null;
          storage_type?: string | null;
          default_location?: Location;
          unit_name?: string | null;
          unit_weight_enabled?: boolean;
          unit_weight?: number | null;
          unit_weight_unit?: UnitWeightUnit | null;
          processing_required?: boolean;
          processed_unit_weight?: number | null;
          processed_unit_weight_unit?: UnitWeightUnit | null;
          product_url?: string | null;
          order_completed?: boolean;
          confirmed_order_pending?: boolean;
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          fresh_order_selected?: boolean;
          fresh_order_selected_at?: string | null;
          receipt_check_only?: boolean;
          status_enabled?: boolean;
          stock_status?: StockStatus | null;
          minimum_stock?: number;
          is_important?: boolean;
          is_active?: boolean;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          name: string;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          name?: string;
          is_active?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };
      confirmed_order_items: {
        Row: {
          id: string;
          store_id: string;
          order_date: string;
          product_id: string;
          product_name: string;
          category: string;
          supplier_name: string | null;
          total_stock: number | null;
          minimum_stock: number | null;
          required_quantity: number | null;
          is_low_stock: boolean;
          fresh_order_selected: boolean;
          urgent_order_requested: boolean;
          urgent_order_quantity: number | null;
          order_completed: boolean;
          confirmation_note: string | null;
          receipt_expected_deleted_at: string | null;
          receipt_expected_deleted_by: string | null;
          confirmed_by: string | null;
          confirmed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          order_date: string;
          product_id: string;
          product_name: string;
          category?: string;
          supplier_name?: string | null;
          total_stock?: number | null;
          minimum_stock?: number | null;
          required_quantity?: number | null;
          is_low_stock?: boolean;
          fresh_order_selected?: boolean;
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          order_completed?: boolean;
          confirmation_note?: string | null;
          receipt_expected_deleted_at?: string | null;
          receipt_expected_deleted_by?: string | null;
          confirmed_by?: string | null;
          confirmed_at?: string;
          created_at?: string;
        };
        Update: {
          store_id?: string;
          order_date?: string;
          product_id?: string;
          product_name?: string;
          category?: string;
          supplier_name?: string | null;
          total_stock?: number | null;
          minimum_stock?: number | null;
          required_quantity?: number | null;
          is_low_stock?: boolean;
          fresh_order_selected?: boolean;
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          order_completed?: boolean;
          confirmation_note?: string | null;
          receipt_expected_deleted_at?: string | null;
          receipt_expected_deleted_by?: string | null;
          confirmed_by?: string | null;
          confirmed_at?: string;
        };
        Relationships: [];
      };
      product_merge_history: {
        Row: {
          id: string;
          store_id: string;
          source_product_id: string;
          target_product_id: string;
          merged_by: string | null;
          merged_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          source_product_id: string;
          target_product_id: string;
          merged_by?: string | null;
          merged_at?: string;
        };
        Update: {
          store_id?: string;
          source_product_id?: string;
          target_product_id?: string;
          merged_by?: string | null;
          merged_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          store_id: string;
          email: string | null;
          display_name: string;
          is_admin: boolean;
          role: "master" | "store_admin" | "staff";
          invited_by: string | null;
          created_at: string;
          updated_at: string;
          deletion_requested_at: string | null;
        };
        Insert: {
          id: string;
          store_id?: string;
          email?: string | null;
          display_name: string;
          is_admin?: boolean;
          role?: "master" | "store_admin" | "staff";
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
          deletion_requested_at?: string | null;
        };
        Update: {
          store_id?: string;
          email?: string | null;
          display_name?: string;
          is_admin?: boolean;
          role?: "master" | "store_admin" | "staff";
          invited_by?: string | null;
          updated_at?: string;
          deletion_requested_at?: string | null;
        };
        Relationships: [];
      };
      staff_permissions: {
        Row: {
          id: string;
          store_id: string;
          user_id: string;
          permission_key: "category_management" | "supplier_management" | "group_order_recipe_management" | "order_confirmation";
          granted_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          user_id: string;
          permission_key: "category_management" | "supplier_management" | "group_order_recipe_management" | "order_confirmation";
          granted_by?: string | null;
          created_at?: string;
        };
        Update: {
          permission_key?: "category_management" | "supplier_management" | "group_order_recipe_management" | "order_confirmation";
          granted_by?: string | null;
        };
        Relationships: [];
      };
      suppliers: {
        Row: {
          id: string;
          name: string;
          order_method: "link" | "sms";
          sms_phone: string | null;
          sms_template: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          order_method?: "link" | "sms";
          sms_phone?: string | null;
          sms_template?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          order_method?: "link" | "sms";
          sms_phone?: string | null;
          sms_template?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      product_units: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          name: string;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          store_id?: string;
          name?: string;
          is_active?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };
      product_barcodes: {
        Row: {
          id: string;
          store_id: string;
          product_id: string;
          barcode: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          product_id: string;
          barcode: string;
          created_at?: string;
        };
        Update: {
          store_id?: string;
          product_id?: string;
          barcode?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_barcodes_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      group_order_menus: {
        Row: {
          id: string;
          store_id: string;
          name: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          name: string;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          sort_order?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_order_menus_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      group_order_recipe_ingredients: {
        Row: {
          id: string;
          store_id: string;
          menu_id: string;
          product_id: string | null;
          ingredient_name: string | null;
          quantity_per_item: number;
          quantity_unit: RecipeUsageUnit;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          menu_id: string;
          product_id?: string | null;
          ingredient_name?: string | null;
          quantity_per_item: number;
          quantity_unit: RecipeUsageUnit;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          product_id?: string | null;
          ingredient_name?: string | null;
          quantity_per_item?: number;
          quantity_unit?: RecipeUsageUnit;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "group_order_recipe_ingredients_menu_id_fkey";
            columns: ["menu_id"];
            isOneToOne: false;
            referencedRelation: "group_order_menus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_order_recipe_ingredients_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_order_recipe_ingredients_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      recipe_import_jobs: {
        Row: {
          id: string;
          store_id: string;
          created_by: string | null;
          source_type: "xlsx" | "xls" | "csv" | "pdf";
          file_name: string;
          file_size: number;
          file_hash: string;
          storage_path: string | null;
          status: string;
          estimated_cost_usd: number;
          approved_cost_usd: number | null;
          actual_cost_usd: number;
          input_tokens: number;
          output_tokens: number;
          provider: string;
          model: string;
          prompt_version: string;
          total_segments: number;
          completed_segments: number;
          error_message: string | null;
          source_expires_at: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          store_id?: string;
          created_by?: string;
          source_type: "xlsx" | "xls" | "csv" | "pdf";
          file_name: string;
          file_size: number;
          file_hash: string;
          storage_path?: string | null;
          status?: string;
          estimated_cost_usd?: number;
          approved_cost_usd?: number | null;
          actual_cost_usd?: number;
          input_tokens?: number;
          output_tokens?: number;
          provider?: string;
          model?: string;
          prompt_version?: string;
          total_segments?: number;
          completed_segments?: number;
          error_message?: string | null;
          source_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: {
          storage_path?: string | null;
          status?: string;
          estimated_cost_usd?: number;
          approved_cost_usd?: number | null;
          actual_cost_usd?: number;
          input_tokens?: number;
          output_tokens?: number;
          total_segments?: number;
          completed_segments?: number;
          error_message?: string | null;
          source_expires_at?: string | null;
          updated_at?: string;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      recipe_import_segments: {
        Row: {
          id: string;
          job_id: string;
          segment_key: string;
          segment_kind: "workbook" | "sheet" | "pdf_pages";
          page_start: number | null;
          page_end: number | null;
          payload: Json | null;
          status: string;
          attempt_count: number;
          extracted_json: Json | null;
          input_tokens: number;
          output_tokens: number;
          actual_cost_usd: number;
          error_message: string | null;
          locked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          segment_key: string;
          segment_kind: "workbook" | "sheet" | "pdf_pages";
          page_start?: number | null;
          page_end?: number | null;
          payload?: Json | null;
          status?: string;
          attempt_count?: number;
          extracted_json?: Json | null;
          input_tokens?: number;
          output_tokens?: number;
          actual_cost_usd?: number;
          error_message?: string | null;
          locked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          payload?: Json | null;
          status?: string;
          attempt_count?: number;
          extracted_json?: Json | null;
          input_tokens?: number;
          output_tokens?: number;
          actual_cost_usd?: number;
          error_message?: string | null;
          locked_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      recipe_import_menus: {
        Row: {
          id: string;
          job_id: string;
          source_key: string;
          name: string;
          sort_order: number;
          yield_quantity: number | null;
          yield_unit: string | null;
          source_refs: Json;
          warnings: Json;
          confidence: number | null;
          review_status: string;
          decision: "create" | "replace" | "skip";
          existing_menu_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          source_key: string;
          name: string;
          sort_order?: number;
          yield_quantity?: number | null;
          yield_unit?: string | null;
          source_refs?: Json;
          warnings?: Json;
          confidence?: number | null;
          review_status?: string;
          decision?: "create" | "replace" | "skip";
          existing_menu_id?: string | null;
          created_at?: string;
        };
        Update: {
          sort_order?: number;
          review_status?: string;
          decision?: "create" | "replace" | "skip";
          existing_menu_id?: string | null;
        };
        Relationships: [];
      };
      recipe_import_ingredients: {
        Row: {
          id: string;
          import_menu_id: string;
          source_name: string;
          source_quantity: number | null;
          source_unit: string | null;
          quantity_per_item: number;
          quantity_unit: RecipeUsageUnit;
          product_id: string | null;
          ingredient_name: string | null;
          source_refs: Json;
          candidates: Json;
          warnings: Json;
          confidence: number | null;
          match_status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          import_menu_id: string;
          source_name: string;
          source_quantity?: number | null;
          source_unit?: string | null;
          quantity_per_item: number;
          quantity_unit: RecipeUsageUnit;
          product_id?: string | null;
          ingredient_name?: string | null;
          source_refs?: Json;
          candidates?: Json;
          warnings?: Json;
          confidence?: number | null;
          match_status?: string;
          created_at?: string;
        };
        Update: {
          product_id?: string | null;
          ingredient_name?: string | null;
          quantity_per_item?: number;
          quantity_unit?: RecipeUsageUnit;
          match_status?: string;
        };
        Relationships: [];
      };
      recipe_product_aliases: {
        Row: {
          id: string;
          store_id: string;
          alias_normalized: string;
          alias_display: string;
          product_id: string;
          unit_context: string | null;
          confirmed_count: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          alias_normalized: string;
          alias_display: string;
          product_id: string;
          unit_context?: string | null;
          confirmed_count?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          alias_normalized?: string;
          alias_display?: string;
          product_id?: string;
          unit_context?: string | null;
          confirmed_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      group_order_events: {
        Row: {
          id: string;
          store_id: string;
          order_date: string;
          organization_name: string;
          customer_contact: string | null;
          requested_time: string;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          order_date: string;
          organization_name: string;
          customer_contact?: string | null;
          requested_time: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          order_date?: string;
          organization_name?: string;
          customer_contact?: string | null;
          requested_time?: string;
          note?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_order_events_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      group_order_event_items: {
        Row: {
          id: string;
          store_id: string;
          event_id: string;
          menu_id: string;
          quantity: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          event_id: string;
          menu_id: string;
          quantity: number;
          created_at?: string;
        };
        Update: {
          menu_id?: string;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "group_order_event_items_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "group_order_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_order_event_items_menu_id_fkey";
            columns: ["menu_id"];
            isOneToOne: false;
            referencedRelation: "group_order_menus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_order_event_items_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      inventory: {
        Row: {
          id: string;
          store_id: string;
          product_id: string;
          warehouse_qty: number;
          store_qty: number;
          warehouse_version: number;
          store_version: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          product_id: string;
          warehouse_qty?: number;
          store_qty?: number;
          warehouse_version?: number;
          store_version?: number;
          updated_at?: string;
        };
        Update: {
          store_id?: string;
          warehouse_qty?: number;
          store_qty?: number;
          warehouse_version?: number;
          store_version?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      inventory_logs: {
        Row: {
          id: string;
          store_id: string;
          product_id: string;
          user_id: string;
          action: InventoryAction;
          source_location: Location | null;
          destination_location: Location | null;
          previous_quantity: number | null;
          new_quantity: number | null;
          quantity: number | null;
          note: string | null;
          warehouse_qty_before: number | null;
          store_qty_before: number | null;
          warehouse_qty_after: number | null;
          store_qty_after: number | null;
          reverted_at: string | null;
          reverted_by: string | null;
          restored_to_log_id: string | null;
          mobile_session_id: string | null;
          mobile_session_sequence: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          product_id: string;
          user_id: string;
          action: InventoryAction;
          source_location?: Location | null;
          destination_location?: Location | null;
          previous_quantity?: number | null;
          new_quantity?: number | null;
          quantity?: number | null;
          note?: string | null;
          warehouse_qty_before?: number | null;
          store_qty_before?: number | null;
          warehouse_qty_after?: number | null;
          store_qty_after?: number | null;
          reverted_at?: string | null;
          reverted_by?: string | null;
          restored_to_log_id?: string | null;
          mobile_session_id?: string | null;
          mobile_session_sequence?: number | null;
          created_at?: string;
        };
        Update: {
          note?: string | null;
          store_id?: string;
          reverted_at?: string | null;
          reverted_by?: string | null;
          mobile_session_id?: string | null;
          mobile_session_sequence?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_logs_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };
      mobile_inventory_sessions: {
        Row: {
          id: string;
          store_id: string;
          product_id: string;
          user_id: string;
          entry_source: string;
          status: string;
          warehouse_qty_started: number;
          store_qty_started: number;
          warehouse_qty_current: number;
          store_qty_current: number;
          warehouse_version: number;
          store_version: number;
          inventory_updated_at: string;
          started_at: string;
          last_activity_at: string;
          finalized_at: string | null;
        };
        Insert: {
          id?: string;
          store_id: string;
          product_id: string;
          user_id: string;
          entry_source: string;
          status?: string;
          warehouse_qty_started: number;
          store_qty_started: number;
          warehouse_qty_current: number;
          store_qty_current: number;
          warehouse_version?: number;
          store_version?: number;
          inventory_updated_at: string;
          started_at?: string;
          last_activity_at?: string;
          finalized_at?: string | null;
        };
        Update: {
          status?: string;
          warehouse_qty_current?: number;
          store_qty_current?: number;
          warehouse_version?: number;
          store_version?: number;
          inventory_updated_at?: string;
          last_activity_at?: string;
          finalized_at?: string | null;
        };
        Relationships: [];
      };
      mobile_inventory_session_events: {
        Row: {
          id: string;
          session_id: string;
          sequence: number;
          request_id: string;
          mode: string;
          target_location: Location | null;
          move_direction: string | null;
          warehouse_qty_before: number;
          store_qty_before: number;
          warehouse_qty_after: number;
          store_qty_after: number;
          warehouse_version_before: number;
          store_version_before: number;
          warehouse_version_after: number;
          store_version_after: number;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          sequence: number;
          request_id: string;
          mode: string;
          target_location?: Location | null;
          move_direction?: string | null;
          warehouse_qty_before: number;
          store_qty_before: number;
          warehouse_qty_after: number;
          store_qty_after: number;
          warehouse_version_before?: number;
          store_version_before?: number;
          warehouse_version_after?: number;
          store_version_after?: number;
          occurred_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      prep_items: {
        Row: {
          id: string;
          store_id: string;
          product_id: string;
          name: string;
          shelf_life_enabled: boolean;
          shelf_life_days: number;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          product_id: string;
          name: string;
          shelf_life_enabled?: boolean;
          shelf_life_days?: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          shelf_life_enabled?: boolean;
          shelf_life_days?: number;
          sort_order?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prep_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prep_items_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      prep_item_ingredients: {
        Row: {
          id: string;
          store_id: string;
          prep_item_id: string;
          ingredient_product_id: string | null;
          ingredient_name: string | null;
          ingredient_unit: "g" | "kg" | "ml" | "L" | "개" | null;
          quantity_per_unit: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          prep_item_id: string;
          ingredient_product_id?: string | null;
          ingredient_name?: string | null;
          ingredient_unit?: "g" | "kg" | "ml" | "L" | "개" | null;
          quantity_per_unit: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          ingredient_product_id?: string | null;
          ingredient_name?: string | null;
          ingredient_unit?: "g" | "kg" | "ml" | "L" | "개" | null;
          quantity_per_unit?: number;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "prep_item_ingredients_prep_item_id_fkey";
            columns: ["prep_item_id"];
            isOneToOne: false;
            referencedRelation: "prep_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prep_item_ingredients_ingredient_product_id_fkey";
            columns: ["ingredient_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prep_item_ingredients_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      prep_batches: {
        Row: {
          id: string;
          store_id: string;
          prep_item_id: string;
          quantity_produced: number;
          quantity_remaining: number;
          manufactured_at: string;
          expires_on: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          prep_item_id: string;
          quantity_produced: number;
          quantity_remaining: number;
          manufactured_at?: string;
          expires_on: string;
          created_by: string;
          created_at?: string;
        };
        Update: {
          quantity_remaining?: number;
        };
        Relationships: [
          {
            foreignKeyName: "prep_batches_prep_item_id_fkey";
            columns: ["prep_item_id"];
            isOneToOne: false;
            referencedRelation: "prep_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prep_batches_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: false;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      dashboard_receipt_deletions: {
        Row: {
          id: string;
          store_id: string;
          product_id: string;
          log_ids: string[];
          warehouse_quantity: number;
          store_quantity: number;
          inventory_reverted: boolean;
          deleted_by: string;
          deleted_at: string;
          restored_by: string | null;
          restored_at: string | null;
        };
        Insert: {
          id?: string;
          store_id?: string;
          product_id: string;
          log_ids: string[];
          warehouse_quantity?: number;
          store_quantity?: number;
          inventory_reverted?: boolean;
          deleted_by: string;
          deleted_at?: string;
          restored_by?: string | null;
          restored_at?: string | null;
        };
        Update: {
          restored_by?: string | null;
          restored_at?: string | null;
        };
        Relationships: [];
      };
      dashboard_todos: {
        Row: {
          id: string;
          store_id: string;
          task_date: string;
          content: string;
          is_completed: boolean;
          completed_at: string | null;
          completed_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          routine_id: string | null;
          stale_inventory_product_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          task_date: string;
          content: string;
          is_completed?: boolean;
          completed_at?: string | null;
          completed_by?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          routine_id?: string | null;
          stale_inventory_product_id?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          store_id?: string;
          task_date?: string;
          content?: string;
          is_completed?: boolean;
          completed_at?: string | null;
          completed_by?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          routine_id?: string | null;
          stale_inventory_product_id?: string | null;
        };
        Relationships: [];
      };
      todo_routines: {
        Row: {
          id: string;
          store_id: string;
          content: string;
          schedule_type: "once" | "daily" | "weekly" | "monthly" | "interval";
          target_date: string | null;
          weekday: number | null;
          month_day: number | null;
          interval_days: number | null;
          starts_on: string;
          ends_on: string | null;
          is_active: boolean;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          content: string;
          schedule_type: "once" | "daily" | "weekly" | "monthly" | "interval";
          target_date?: string | null;
          weekday?: number | null;
          month_day?: number | null;
          interval_days?: number | null;
          starts_on?: string;
          ends_on?: string | null;
          is_active?: boolean;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          store_id?: string;
          content?: string;
          schedule_type?: "once" | "daily" | "weekly" | "monthly" | "interval";
          target_date?: string | null;
          weekday?: number | null;
          month_day?: number | null;
          interval_days?: number | null;
          starts_on?: string;
          ends_on?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      inventory_check_todo_settings: {
        Row: {
          store_id: string;
          is_enabled: boolean;
          threshold_days: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          store_id: string;
          is_enabled?: boolean;
          threshold_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          is_enabled?: boolean;
          threshold_days?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_check_todo_settings_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: true;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      inventory_overview_settings: {
        Row: {
          store_id: string;
          abundant_multiplier: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          store_id: string;
          abundant_multiplier?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          abundant_multiplier?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_overview_settings_store_id_fkey";
            columns: ["store_id"];
            isOneToOne: true;
            referencedRelation: "stores";
            referencedColumns: ["id"];
          }
        ];
      };
      handover_notes: {
        Row: {
          id: string;
          store_id: string;
          handover_date: string;
          content: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          handover_date: string;
          content: string;
          created_by: string;
          created_at?: string;
        };
        Update: {
          content?: string;
        };
        Relationships: [];
      };
      weekly_store_closures: {
        Row: {
          weekday: number;
          created_by: string;
          created_at: string;
        };
        Insert: {
          weekday: number;
          created_by: string;
          created_at?: string;
        };
        Update: {
          weekday?: number;
        };
        Relationships: [];
      };
      store_closure_dates: {
        Row: {
          closure_date: string;
          reason: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          closure_date: string;
          reason?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          reason?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: {
        Args: {
          user_id: string;
        };
        Returns: boolean;
      };
      merge_products: {
        Args: {
          target_product_id: string;
          source_product_id: string;
        };
        Returns: undefined;
      };
      register_and_merge_product: {
        Args: {
          product_store_id: string;
          product_data: Json;
          existing_product_id: string;
          keep_new_product: boolean;
        };
        Returns: string;
      };
      restore_inventory_to_log: {
        Args: {
          target_log_id: string;
          restored_warehouse_qty: number;
          restored_store_qty: number;
        };
        Returns: undefined;
      };
      restore_inventory_to_log_v2: {
        Args: {
          target_log_id: string;
          restored_warehouse_qty: number;
          restored_store_qty: number;
          expected_warehouse_version: number;
          expected_store_version: number;
          request_id: string;
        };
        Returns: {
          warehouse_qty: number;
          store_qty: number;
          warehouse_version: number;
          store_version: number;
          inventory_updated_at: string;
        }[];
      };
      apply_mobile_inventory_change: {
        Args: {
          target_session_id: string | null;
          target_product_id: string;
          operation_mode: string;
          target_location: string | null;
          move_direction: string | null;
          requested_warehouse_qty: number;
          requested_store_qty: number;
          expected_inventory_updated_at: string;
          request_id: string;
          entry_source: string;
        };
        Returns: {
          session_id: string;
          warehouse_qty: number;
          store_qty: number;
          inventory_updated_at: string;
          last_activity_at: string;
        }[];
      };
      apply_mobile_inventory_change_v2: {
        Args: {
          target_session_id: string | null;
          target_product_id: string;
          operation_mode: string;
          target_location: string | null;
          move_direction: string | null;
          requested_warehouse_qty: number;
          requested_store_qty: number;
          expected_warehouse_version: number;
          expected_store_version: number;
          request_id: string;
          entry_source: string;
        };
        Returns: {
          session_id: string;
          warehouse_qty: number;
          store_qty: number;
          warehouse_version: number;
          store_version: number;
          inventory_updated_at: string;
          last_activity_at: string;
        }[];
      };
      finalize_mobile_inventory_session: {
        Args: {
          target_session_id: string;
          finalization_reason?: string;
        };
        Returns: string[];
      };
      recover_mobile_inventory_sessions: {
        Args: {
          active_session_id?: string | null;
        };
        Returns: string[];
      };
      restore_inventory_to_mobile_session: {
        Args: {
          target_session_id: string;
          restored_warehouse_qty: number;
          restored_store_qty: number;
        };
        Returns: undefined;
      };
      restore_inventory_to_mobile_session_v2: {
        Args: {
          target_session_id: string;
          restored_warehouse_qty: number;
          restored_store_qty: number;
          expected_warehouse_version: number;
          expected_store_version: number;
          request_id: string;
        };
        Returns: {
          warehouse_qty: number;
          store_qty: number;
          warehouse_version: number;
          store_version: number;
          inventory_updated_at: string;
        }[];
      };
      record_inventory_operation: {
        Args: {
          target_product_id: string;
          operation_action: string;
          target_location: string;
          move_direction: string;
          operation_quantity: number;
          expected_inventory_updated_at: string;
        };
        Returns: string;
      };
      record_receipt_check: {
        Args: {
          target_product_id: string;
          receipt_quantity: number | null;
          receipt_note?: string;
        };
        Returns: string;
      };
      replace_confirmed_order_items: {
        Args: {
          target_store_id: string;
          target_order_date: string;
          item_rows: Json;
          confirmation_note?: string | null;
        };
        Returns: Database["public"]["Tables"]["confirmed_order_items"]["Row"][];
      };
      add_confirmed_order_item: {
        Args: {
          target_store_id: string;
          target_order_date: string;
          target_product_id: string;
          required_quantity_value?: number | null;
        };
        Returns: Database["public"]["Tables"]["confirmed_order_items"]["Row"];
      };
      remove_confirmed_order_item: {
        Args: {
          target_store_id: string;
          target_confirmed_item_id: string;
        };
        Returns: string;
      };
      cancel_confirmed_order: {
        Args: {
          target_store_id: string;
          target_order_date: string;
        };
        Returns: number;
      };
      record_inventory_operation_idempotent: {
        Args: {
          target_product_id: string;
          operation_action: string;
          target_location: string;
          move_direction: string;
          operation_quantity: number;
          expected_inventory_updated_at: string;
          request_id: string;
        };
        Returns: string;
      };
      record_inventory_operation_idempotent_v2: {
        Args: {
          target_product_id: string;
          operation_action: string;
          target_location: string;
          move_direction: string;
          operation_quantity: number;
          expected_warehouse_version: number;
          expected_store_version: number;
          request_id: string;
        };
        Returns: {
          log_id: string;
          warehouse_qty: number;
          store_qty: number;
          warehouse_version: number;
          store_version: number;
          inventory_updated_at: string;
        }[];
      };
      record_inventory_check: {
        Args: {
          target_product_id: string;
          target_location: string;
          expected_warehouse_version: number;
          expected_store_version: number;
          request_id: string;
        };
        Returns: {
          log_id: string;
          checked_at: string;
        }[];
      };
      record_receipt_check_idempotent: {
        Args: {
          target_product_id: string;
          receipt_quantity: number | null;
          receipt_note: string;
          request_id: string;
        };
        Returns: string;
      };
      replace_confirmed_order_items_idempotent: {
        Args: {
          target_store_id: string;
          target_order_date: string;
          item_rows: Json;
          confirmation_note: string | null;
          request_id: string;
        };
        Returns: Database["public"]["Tables"]["confirmed_order_items"]["Row"][];
      };
      add_confirmed_order_item_idempotent: {
        Args: {
          target_store_id: string;
          target_order_date: string;
          target_product_id: string;
          required_quantity_value: number | null;
          request_id: string;
        };
        Returns: Database["public"]["Tables"]["confirmed_order_items"]["Row"];
      };
      remove_confirmed_order_item_idempotent: {
        Args: {
          target_store_id: string;
          target_confirmed_item_id: string;
          request_id: string;
        };
        Returns: string;
      };
      cancel_confirmed_order_idempotent: {
        Args: {
          target_store_id: string;
          target_order_date: string;
          request_id: string;
        };
        Returns: number;
      };
      diagnose_store_consistency: {
        Args: {
          target_store_id: string;
        };
        Returns: {
          product_id: string;
          product_name: string;
          issue_type: string;
          expected_value: Json;
          actual_value: Json;
          last_changed_at: string;
        }[];
      };
      rename_product_unit: {
        Args: {
          target_unit_id: string;
          next_name: string;
        };
        Returns: Database["public"]["Tables"]["product_units"]["Row"];
      };
      delete_today_product_receipts: {
        Args: {
          target_product_id: string;
        };
        Returns: string;
      };
      delete_today_product_receipts_idempotent: {
        Args: {
          target_product_id: string;
          request_id: string;
        };
        Returns: string;
      };
      delete_dashboard_expected_receipt: {
        Args: {
          target_product_id: string;
          target_order_dates: string[];
        };
        Returns: number;
      };
      delete_dashboard_expected_receipt_idempotent: {
        Args: {
          target_product_id: string;
          target_order_dates: string[];
          request_id: string;
        };
        Returns: number;
      };
      restore_latest_dashboard_receipt_deletion: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      restore_latest_dashboard_receipt_deletion_idempotent: {
        Args: {
          request_id: string;
        };
        Returns: string;
      };
      resolve_store_staff_names: {
        Args: {
          target_store_id: string;
          user_ids: string[];
        };
        Returns: {
          user_id: string;
          display_name: string;
        }[];
      };
      create_store_invite: {
        Args: {
          target_role?: "store_admin" | "staff";
        };
        Returns: Database["public"]["Tables"]["store_invites"]["Row"];
      };
      accept_store_invite_code: {
        Args: {
          invite_code: string;
        };
        Returns: Database["public"]["Tables"]["profiles"]["Row"];
      };
      create_personal_store: {
        Args: {
          store_name: string;
        };
        Returns: Database["public"]["Tables"]["profiles"]["Row"];
      };
      delete_prep_item: {
        Args: {
          target_prep_item_id: string;
        };
        Returns: undefined;
      };
      save_prep_item: {
        Args: {
          target_prep_item_id: string | null;
          item_name: string;
          item_shelf_life_enabled: boolean;
          item_shelf_life_days: number;
          item_sort_order: number;
          ingredient_rows: Json;
          item_is_active?: boolean;
        };
        Returns: Database["public"]["Tables"]["prep_items"]["Row"];
      };
      record_prep_operation: {
        Args: {
          target_prep_item_id: string;
          operation_type: string;
          operation_quantity: number;
        };
        Returns: {
          log_id: string | null;
          warning_message: string | null;
        };
      };
      reorder_prep_items: {
        Args: {
          ordered_prep_item_ids: string[];
        };
        Returns: undefined;
      };
      create_recipe_import_job: {
        Args: {
          target_store_id: string;
          target_source_type: "xlsx" | "xls" | "csv" | "pdf";
          target_file_name: string;
          target_file_size: number;
          target_file_hash: string;
          target_estimated_cost_usd: number;
        };
        Returns: Database["public"]["Tables"]["recipe_import_jobs"]["Row"];
      };
      approve_recipe_import_job: {
        Args: {
          target_job_id: string;
          target_approved_cost_usd: number;
        };
        Returns: Database["public"]["Tables"]["recipe_import_jobs"]["Row"];
      };
      mark_recipe_import_uploaded: {
        Args: {
          target_job_id: string;
        };
        Returns: Database["public"]["Tables"]["recipe_import_jobs"]["Row"];
      };
      apply_group_order_recipe_import_idempotent: {
        Args: {
          target_job_id: string;
          request_id: string;
        };
        Returns: Json;
      };
      link_recipe_product_alias: {
        Args: {
          target_store_id: string;
          target_alias: string;
          target_product_id: string;
          target_unit_context?: string | null;
        };
        Returns: Database["public"]["Tables"]["recipe_product_aliases"]["Row"];
      };
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
