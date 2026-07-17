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
          status: "active" | "inactive";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          business_name?: string | null;
          status?: "active" | "inactive";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          business_name?: string | null;
          status?: "active" | "inactive";
          updated_at?: string;
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
          urgent_order_requested: boolean;
          urgent_order_quantity: number | null;
          fresh_order_selected: boolean;
          fresh_order_selected_at: string | null;
          receipt_check_only: boolean;
          status_enabled: boolean;
          stock_status: StockStatus | null;
          minimum_stock: number;
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
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          fresh_order_selected?: boolean;
          fresh_order_selected_at?: string | null;
          receipt_check_only?: boolean;
          status_enabled?: boolean;
          stock_status?: StockStatus | null;
          minimum_stock?: number;
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
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          fresh_order_selected?: boolean;
          fresh_order_selected_at?: string | null;
          receipt_check_only?: boolean;
          status_enabled?: boolean;
          stock_status?: StockStatus | null;
          minimum_stock?: number;
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
          is_low_stock: boolean;
          fresh_order_selected: boolean;
          urgent_order_requested: boolean;
          urgent_order_quantity: number | null;
          order_completed: boolean;
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
          is_low_stock?: boolean;
          fresh_order_selected?: boolean;
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          order_completed?: boolean;
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
          is_low_stock?: boolean;
          fresh_order_selected?: boolean;
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          order_completed?: boolean;
          confirmed_by?: string | null;
          confirmed_at?: string;
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
        };
        Update: {
          store_id?: string;
          email?: string | null;
          display_name?: string;
          is_admin?: boolean;
          role?: "master" | "store_admin" | "staff";
          invited_by?: string | null;
          updated_at?: string;
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
          product_id: string;
          quantity_per_item: number;
          quantity_unit: RecipeUsageUnit;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          menu_id: string;
          product_id: string;
          quantity_per_item: number;
          quantity_unit: RecipeUsageUnit;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          product_id?: string;
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
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id?: string;
          product_id: string;
          warehouse_qty?: number;
          store_qty?: number;
          updated_at?: string;
        };
        Update: {
          store_id?: string;
          warehouse_qty?: number;
          store_qty?: number;
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
          created_at?: string;
        };
        Update: {
          store_id?: string;
          reverted_at?: string | null;
          reverted_by?: string | null;
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
          product_id: string;
          log_ids: string[];
          warehouse_quantity: number;
          store_quantity: number;
          deleted_by: string;
          deleted_at: string;
          restored_by: string | null;
          restored_at: string | null;
        };
        Insert: {
          id?: string;
          product_id: string;
          log_ids: string[];
          warehouse_quantity?: number;
          store_quantity?: number;
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
          schedule_type: "once" | "weekly" | "monthly";
          target_date: string | null;
          weekday: number | null;
          month_day: number | null;
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
          schedule_type: "once" | "weekly" | "monthly";
          target_date?: string | null;
          weekday?: number | null;
          month_day?: number | null;
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
          schedule_type?: "once" | "weekly" | "monthly";
          target_date?: string | null;
          weekday?: number | null;
          month_day?: number | null;
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
      restore_inventory_to_log: {
        Args: {
          target_log_id: string;
          restored_warehouse_qty: number;
          restored_store_qty: number;
        };
        Returns: undefined;
      };
      delete_today_product_receipts: {
        Args: {
          target_product_id: string;
        };
        Returns: string;
      };
      restore_latest_dashboard_receipt_deletion: {
        Args: Record<PropertyKey, never>;
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
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
