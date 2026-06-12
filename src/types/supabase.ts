import type { Category, InventoryAction, Location, StockStatus } from "./domain";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      products: {
        Row: {
          id: string;
          barcode: string | null;
          name: string;
          category: Category;
          supplier_name: string | null;
          storage_type: string | null;
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
          email: string | null;
          display_name: string;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          display_name: string;
          is_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string | null;
          display_name?: string;
          is_admin?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      suppliers: {
        Row: {
          id: string;
          name: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          is_active?: boolean;
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
          created_at?: string;
        };
        Update: never;
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
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
