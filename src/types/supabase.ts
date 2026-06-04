import type { Category, InventoryAction, Location } from "./domain";

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
          minimum_stock: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          barcode?: string | null;
          name: string;
          category: Category;
          minimum_stock?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          barcode?: string | null;
          name?: string;
          category?: Category;
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
    };
    Functions: {
      is_admin: {
        Args: {
          user_id: string;
        };
        Returns: boolean;
      };
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
