import type { Category, InventoryAction, Location, StockStatus } from "./domain";

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
          email: string;
          role: "store_admin" | "staff";
          token: string;
          invited_by: string;
          accepted_by: string | null;
          accepted_at: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          email: string;
          role?: "store_admin" | "staff";
          token?: string;
          invited_by: string;
          accepted_by?: string | null;
          accepted_at?: string | null;
          expires_at?: string;
          created_at?: string;
        };
        Update: {
          email?: string;
          role?: "store_admin" | "staff";
          token?: string;
          accepted_by?: string | null;
          accepted_at?: string | null;
          expires_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          barcode: string | null;
          name: string;
          category: Category;
          supplier_name: string | null;
          storage_type: string | null;
          unit_name: string | null;
          product_url: string | null;
          order_completed: boolean;
          urgent_order_requested: boolean;
          urgent_order_quantity: number | null;
          fresh_order_selected: boolean;
          fresh_order_selected_at: string | null;
          status_enabled: boolean;
          stock_status: StockStatus | null;
          minimum_stock: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          barcode?: string | null;
          name: string;
          category: Category;
          supplier_name?: string | null;
          storage_type?: string | null;
          unit_name?: string | null;
          product_url?: string | null;
          order_completed?: boolean;
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          fresh_order_selected?: boolean;
          fresh_order_selected_at?: string | null;
          status_enabled?: boolean;
          stock_status?: StockStatus | null;
          minimum_stock?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          barcode?: string | null;
          name?: string;
          category?: Category;
          supplier_name?: string | null;
          storage_type?: string | null;
          unit_name?: string | null;
          product_url?: string | null;
          order_completed?: boolean;
          urgent_order_requested?: boolean;
          urgent_order_quantity?: number | null;
          fresh_order_selected?: boolean;
          fresh_order_selected_at?: string | null;
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
          product_id: string;
          barcode: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          barcode: string;
          created_at?: string;
        };
        Update: {
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
      inventory: {
        Row: {
          id: string;
          product_id: string;
          warehouse_qty: number;
          store_qty: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          warehouse_qty?: number;
          store_qty?: number;
          updated_at?: string;
        };
        Update: {
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
          task_date: string;
          content: string;
          is_completed: boolean;
          completed_at: string | null;
          completed_by: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_date: string;
          content: string;
          is_completed?: boolean;
          completed_at?: string | null;
          completed_by?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          content?: string;
          is_completed?: boolean;
          completed_at?: string | null;
          completed_by?: string | null;
        };
        Relationships: [];
      };
      handover_notes: {
        Row: {
          id: string;
          handover_date: string;
          content: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
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
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
